import type {
  FactoryBoard,
  FactoryBoardTask,
  FactoryStage,
  FactoryVerifySummary
} from '../../../../shared/factory-types'
import { LEGACY_RUN_ID } from '../db/contract-constants'
import type { OrchestrationDb } from '../db'
import type { FactoryVerifyResultRow } from '../db/factory/factory-row-types'
import type { TaskRow } from '../types'

export function summarizeFactoryVerify(row: FactoryVerifyResultRow): FactoryVerifySummary {
  return {
    id: row.id,
    status: row.status,
    exitCode: row.exit_code,
    timedOut: row.timed_out === 1,
    durationMs: row.duration_ms,
    outputTail: row.output_tail,
    completedAt: row.completed_at
  }
}

export function deriveFactoryStage(
  task: Pick<TaskRow, 'status'>,
  verify: FactoryVerifyResultRow | undefined,
  landed: boolean
): FactoryStage {
  if (landed) {
    return 'landed'
  }
  switch (task.status) {
    case 'pending':
    case 'ready':
      return 'planned'
    case 'dispatched':
      if (verify?.status === 'running') {
        return 'verifying'
      }
      return verify && verify.status !== 'passed' ? 'verify_failed' : 'building'
    case 'completed':
      return 'review'
    case 'failed':
      return 'failed'
    case 'blocked':
      return 'blocked'
  }
}

function parseDeps(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((dep) => typeof dep === 'string') : []
  } catch {
    return []
  }
}

/** Without an explicit run, shows the newest real run: the legacy holding run is never a plan. */
export function buildFactoryBoard(db: OrchestrationDb, runId?: string): FactoryBoard {
  const run = runId
    ? db.getRun(runId)
    : db.listRuns().runs.find((candidate) => candidate.id !== LEGACY_RUN_ID)
  if (!run) {
    return { runId: null, objective: null, tasks: [] }
  }
  const tasks = db.listTasks({ runId: run.id })
  const verifies = db.listLatestFactoryVerifyResults(tasks.map((task) => task.id))
  const landings = new Map(
    db.listFactoryLandings(run.id).map((landing) => [landing.task_id, landing])
  )
  const boardTasks: FactoryBoardTask[] = tasks.map((task) => {
    const verify = verifies.get(task.id)
    const landing = landings.get(task.id)
    return {
      taskId: task.id,
      title: task.task_title ?? task.display_name ?? task.spec.split('\n')[0].slice(0, 120),
      status: task.status,
      deps: parseDeps(task.deps),
      stage: deriveFactoryStage(task, verify, Boolean(landing)),
      verify: verify ? summarizeFactoryVerify(verify) : null,
      landedOn: landing?.integration_branch ?? null
    }
  })
  return { runId: run.id, objective: run.objective, tasks: boardTasks }
}
