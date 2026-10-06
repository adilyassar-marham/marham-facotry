import type { FactoryCleanupResult } from '../../../../shared/factory-run-types'
import type { OrchestrationDb } from '../db'
import { listUncommittedChanges, runLocalGit, type FactoryGitRunner } from './factory-git'
import type { FactoryVerifyHost } from './factory-verify'

export type FactoryCleanupHost = FactoryVerifyHost & {
  removeFactoryWorktree(worktreeId: string): Promise<void>
}

const normalizeBranch = (branch: string | null | undefined): string | null =>
  branch?.replace(/^refs\/heads\//, '') || null

/**
 * Removes worker and reviewer worktrees of finished tasks. Keeps anything that could hold work a
 * person wants: failed tasks, open tasks, uncommitted work, and branches git will not safely delete.
 * The integration worktree always stays; it is what the PR is opened from.
 */
export async function cleanupFactoryRun(
  db: OrchestrationDb,
  host: FactoryCleanupHost,
  params: { runId: string },
  deps: { git?: FactoryGitRunner } = {}
): Promise<FactoryCleanupResult> {
  const git = deps.git ?? runLocalGit
  db.requireRun(params.runId)
  const integrationId = db.getFactoryIntegration(params.runId)?.worktree_id
  const result: FactoryCleanupResult = { runId: params.runId, removed: [], kept: [] }
  const landed = new Set(db.listFactoryLandings(params.runId).map((landing) => landing.task_id))
  const reviews = new Set(db.listFactoryReviews(params.runId).map((review) => review.task_id))
  for (const task of db.listTasks({ runId: params.runId })) {
    for (const worktreeId of db.listFactoryTaskWorktreeIds(task.id)) {
      if (worktreeId === integrationId) {
        continue
      }
      let target: Awaited<ReturnType<FactoryVerifyHost['resolveFactoryWorktreeTarget']>>
      try {
        target = await host.resolveFactoryWorktreeTarget(`id:${worktreeId}`)
      } catch {
        // Already removed: nothing to clean.
        continue
      }
      const keep = (reason: string): void => {
        result.kept.push({ taskId: task.id, worktreePath: target.worktree.path, reason })
      }
      if (task.status !== 'completed') {
        keep(`task is ${task.status}; its work may still matter`)
        continue
      }
      // Why: land reads the branch from the worker worktree, so unlanded work keeps it.
      if (!reviews.has(task.id) && !landed.has(task.id)) {
        keep('not landed yet')
        continue
      }
      // Only factory scratch (.orca/) and ignored files may remain; the removal discards them.
      const changes = await listUncommittedChanges(git, target.worktree.path, target.wslDistro)
      if (!changes || changes.length > 0) {
        keep('uncommitted changes')
        continue
      }
      try {
        await host.removeFactoryWorktree(worktreeId)
      } catch (error) {
        keep(`removal failed: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      const branch = normalizeBranch(target.worktree.branch)
      // Why -d, not -D: git refuses to delete a branch whose commits are not merged anywhere.
      const deleted =
        branch && target.repo
          ? (await git(['branch', '-d', branch], target.repo.path, target.wslDistro)).ok
          : false
      result.removed.push({
        taskId: task.id,
        worktreePath: target.worktree.path,
        branch: deleted ? branch : null
      })
    }
  }
  return result
}
