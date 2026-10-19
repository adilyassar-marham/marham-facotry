import type { OrchestrationDb } from '../db'

const WORKING = new Set(['pending', 'ready', 'dispatched', 'blocked'])

/** True while agents may still be writing this run. A merged PR or a cancelled request is finished. */
export function factoryRunBlocksSkillSync(db: OrchestrationDb, runId: string): boolean {
  if (db.getFactoryPullRequest(runId)) {
    return false
  }
  const request = db.getFactoryRequestByRun(runId)
  if (request?.cancelled) {
    return false
  }
  if (db.listTasks({ runId }).some((task) => WORKING.has(task.status))) {
    return true
  }
  const reviews = db.listFactoryReviews(runId)
  if (reviews.some((review) => review.verdict === 'pending')) {
    return true
  }
  return !reviews.some((review) => review.verdict === 'pass')
}

export function factoryRepoBlocksSkillSync(db: OrchestrationDb, repoId: string): boolean {
  return db.listFactoryRunsForRepo(repoId).some((run) => factoryRunBlocksSkillSync(db, run.run_id))
}
