import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import type { FactoryReviewRow } from './factory-row-types'

export function createFactoryReview(
  this: OrchestrationDb,
  params: {
    runId: string
    round: number
    taskId: string | null
    headSha: string
    verdict?: 'pending' | 'fail'
    summary?: string
    findings?: string
  }
): FactoryReviewRow {
  const id = generateId('frev')
  this.db
    .prepare(
      `INSERT INTO factory_reviews
         (id, run_id, round, task_id, head_sha, verdict, summary, findings, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'pending' THEN NULL ELSE datetime('now') END)`
    )
    .run(
      id,
      params.runId,
      params.round,
      params.taskId,
      params.headSha,
      params.verdict ?? 'pending',
      params.summary ?? '',
      params.findings ?? '[]',
      params.verdict ?? 'pending'
    )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_reviews WHERE id = ?').get(id) as FactoryReviewRow
}

export function listFactoryReviews(this: OrchestrationDb, runId: string): FactoryReviewRow[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare('SELECT * FROM factory_reviews WHERE run_id = ? ORDER BY round, rowid')
    .all(runId) as FactoryReviewRow[]
}

export function getFactoryReviewByTask(
  this: OrchestrationDb,
  taskId: string
): FactoryReviewRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_reviews WHERE task_id = ?').get(taskId) as
    | FactoryReviewRow
    | undefined
}

/** Only a pending round accepts a verdict, so a replayed report cannot flip a decided one. */
export function submitFactoryReview(
  this: OrchestrationDb,
  params: { reviewId: string; verdict: 'pass' | 'fail'; summary: string; findings: string }
): boolean {
  return (
    this.db
      .prepare(
        `UPDATE factory_reviews SET verdict = ?, summary = ?, findings = ?,
           submitted_at = datetime('now')
         WHERE id = ? AND verdict = 'pending'`
      )
      .run(params.verdict, params.summary, params.findings, params.reviewId).changes > 0
  )
}

/** Links a failed round to its fix task once; a second fix for the same round is refused. */
export function linkFactoryReviewFix(
  this: OrchestrationDb,
  reviewId: string,
  fixTaskId: string
): boolean {
  return (
    this.db
      .prepare(
        `UPDATE factory_reviews SET fix_task_id = ?
         WHERE id = ? AND verdict = 'fail' AND fix_task_id IS NULL`
      )
      .run(fixTaskId, reviewId).changes > 0
  )
}

/** Every worktree a Task's dispatches ever used, review tasks included, for cleanup. */
export function listFactoryTaskWorktreeIds(this: OrchestrationDb, taskId: string): string[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the query selects exactly one id column.
  const rows = this.db
    .prepare(
      `SELECT DISTINCT wd.worktree_id AS id FROM worker_dispatches wd
       JOIN dispatch_contexts dc ON dc.id = wd.dispatch_id
       WHERE dc.task_id = ? AND wd.worktree_id IS NOT NULL AND wd.worktree_id != ''`
    )
    .all(taskId) as { id: string }[]
  return rows.map((row) => row.id)
}

export type FactoryReviewStoreMethods = {
  createFactoryReview: typeof createFactoryReview
  listFactoryReviews: typeof listFactoryReviews
  getFactoryReviewByTask: typeof getFactoryReviewByTask
  submitFactoryReview: typeof submitFactoryReview
  linkFactoryReviewFix: typeof linkFactoryReviewFix
  listFactoryTaskWorktreeIds: typeof listFactoryTaskWorktreeIds
}

export function attachFactoryReviewStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createFactoryReview,
    listFactoryReviews,
    getFactoryReviewByTask,
    submitFactoryReview,
    linkFactoryReviewFix,
    listFactoryTaskWorktreeIds
  })
}
