import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import type { FactoryReviewDetailsRow, FactoryReviewRow } from './factory-row-types'

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

export function recordFactoryReviewDetails(
  this: OrchestrationDb,
  row: FactoryReviewDetailsRow
): void {
  this.db
    .prepare(
      `INSERT INTO factory_review_details
         (review_id, standards_json, spec_json, smells_json, blast_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(review_id) DO UPDATE SET
         standards_json = excluded.standards_json,
         spec_json = excluded.spec_json,
         smells_json = excluded.smells_json,
         blast_json = excluded.blast_json`
    )
    .run(row.review_id, row.standards_json, row.spec_json, row.smells_json, row.blast_json)
}

export function getFactoryReviewDetails(
  this: OrchestrationDb,
  reviewId: string
): FactoryReviewDetailsRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare('SELECT * FROM factory_review_details WHERE review_id = ?')
    .get(reviewId) as FactoryReviewDetailsRow | undefined
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
  recordFactoryReviewDetails: typeof recordFactoryReviewDetails
  getFactoryReviewDetails: typeof getFactoryReviewDetails
  linkFactoryReviewFix: typeof linkFactoryReviewFix
  listFactoryTaskWorktreeIds: typeof listFactoryTaskWorktreeIds
}

export function attachFactoryReviewStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createFactoryReview,
    listFactoryReviews,
    getFactoryReviewByTask,
    submitFactoryReview,
    recordFactoryReviewDetails,
    getFactoryReviewDetails,
    linkFactoryReviewFix,
    listFactoryTaskWorktreeIds
  })
}
