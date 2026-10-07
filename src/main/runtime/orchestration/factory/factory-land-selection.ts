import { splitWorktreeId } from '../../../../shared/worktree/id'
import { FACTORY_SUPERSEDED_TASK_RESULT } from '../../../../shared/factory-request-types'
import type { OrchestrationDb } from '../db'
import type { TaskRow } from '../types'

export type FactoryLandCandidate = {
  taskId: string
  title: string
  worktreeId: string
  repoId: string
}

export type FactoryLandSelection = {
  candidates: FactoryLandCandidate[]
  alreadyLanded: string[]
  skipped: { taskId: string; reason: string }[]
}

function parseDeps(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((dep) => typeof dep === 'string') : []
  } catch {
    return []
  }
}

function dependencyOrder(tasks: TaskRow[]): TaskRow[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const ordered: TaskRow[] = []
  const seen = new Set<string>()
  const visit = (task: TaskRow): void => {
    if (seen.has(task.id)) {
      return
    }
    // Why mark first: createTask only accepts existing deps, so cycles cannot exist; this is cheap insurance.
    seen.add(task.id)
    for (const dep of parseDeps(task.deps)) {
      const depTask = byId.get(dep)
      if (depTask) {
        visit(depTask)
      }
    }
    ordered.push(task)
  }
  tasks.forEach(visit)
  return ordered
}

/**
 * A Task lands only when it is completed, every dependency is already on the integration branch,
 * and — in a gated repo — its newest verify passed. A Task that cannot land holds its dependents.
 */
export function selectFactoryLandCandidates(
  db: OrchestrationDb,
  runId: string
): FactoryLandSelection {
  const landed = new Set(db.listFactoryLandings(runId).map((landing) => landing.task_id))
  const held = new Set<string>()
  const selection: FactoryLandSelection = { candidates: [], alreadyLanded: [], skipped: [] }
  const hold = (taskId: string, reason: string): void => {
    held.add(taskId)
    selection.skipped.push({ taskId, reason })
  }
  for (const task of dependencyOrder(db.listTasks({ runId }))) {
    // A plan the requester sent back was replaced; its tasks are history, not work to land.
    if (task.result === FACTORY_SUPERSEDED_TASK_RESULT) {
      continue
    }
    if (landed.has(task.id)) {
      selection.alreadyLanded.push(task.id)
      continue
    }
    const blockingDep = parseDeps(task.deps).find((dep) => held.has(dep))
    if (blockingDep) {
      hold(task.id, `waits for ${blockingDep} to land first`)
      continue
    }
    if (task.status !== 'completed') {
      hold(task.id, `not completed (status: ${task.status})`)
      continue
    }
    const worktree = db.findFactoryTaskWorktree(task.id)
    const repoId = worktree ? splitWorktreeId(worktree.worktree_id)?.repoId : undefined
    if (!worktree || !repoId) {
      // Planning or review tasks change no code; they never hold their dependents.
      selection.skipped.push({ taskId: task.id, reason: 'no worker worktree; nothing to merge' })
      continue
    }
    if (db.getFactoryGateApproval(repoId)) {
      const verify = db.listLatestFactoryVerifyResults([task.id]).get(task.id)
      if (verify?.status !== 'passed') {
        hold(task.id, 'completed without a passing verify on record')
        continue
      }
    }
    selection.candidates.push({
      taskId: task.id,
      title: task.task_title ?? task.display_name ?? task.id,
      worktreeId: worktree.worktree_id,
      repoId
    })
  }
  return selection
}
