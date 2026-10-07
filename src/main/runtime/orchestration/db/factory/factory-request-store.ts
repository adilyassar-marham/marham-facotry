import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import type {
  FactoryPlanApprovalRow,
  FactoryQuestionRow,
  FactoryRequestRow
} from './factory-row-types'

export function createFactoryRequest(
  this: OrchestrationDb,
  params: { repoId: string; title: string; description: string; agent: string }
): FactoryRequestRow {
  const id = generateId('freq')
  this.db
    .prepare(
      `INSERT INTO factory_requests (id, repo_id, title, description, agent)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, params.repoId, params.title, params.description, params.agent)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: inserted on the line above.
  return this.getFactoryRequest(id) as FactoryRequestRow
}

export function getFactoryRequest(
  this: OrchestrationDb,
  id: string
): FactoryRequestRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_requests WHERE id = ?').get(id) as
    | FactoryRequestRow
    | undefined
}

export function getFactoryRequestByRun(
  this: OrchestrationDb,
  runId: string
): FactoryRequestRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_requests WHERE run_id = ?').get(runId) as
    | FactoryRequestRow
    | undefined
}

export function listFactoryRequests(this: OrchestrationDb): FactoryRequestRow[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare('SELECT * FROM factory_requests ORDER BY created_at DESC, rowid DESC')
    .all() as FactoryRequestRow[]
}

export function setFactoryRequestWorktree(
  this: OrchestrationDb,
  id: string,
  worktreeId: string
): void {
  this.db.prepare('UPDATE factory_requests SET worktree_id = ? WHERE id = ?').run(worktreeId, id)
}

/** First link wins, so a confused coordinator cannot move a request onto another run. */
export function linkFactoryRequestRun(this: OrchestrationDb, id: string, runId: string): boolean {
  return (
    this.db
      .prepare('UPDATE factory_requests SET run_id = ? WHERE id = ? AND run_id IS NULL')
      .run(runId, id).changes > 0
  )
}

export function cancelFactoryRequest(this: OrchestrationDb, id: string): void {
  this.db.prepare('UPDATE factory_requests SET cancelled = 1 WHERE id = ?').run(id)
}

export function getFactoryPlanApproval(
  this: OrchestrationDb,
  runId: string
): FactoryPlanApprovalRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_plan_approvals WHERE run_id = ?').get(runId) as
    | FactoryPlanApprovalRow
    | undefined
}

export function setFactoryPlanApproval(
  this: OrchestrationDb,
  params: { runId: string; status: FactoryPlanApprovalRow['status']; feedback?: string | null }
): void {
  this.db
    .prepare(
      `INSERT INTO factory_plan_approvals (run_id, status, feedback) VALUES (?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET status = excluded.status, feedback = excluded.feedback,
         updated_at = datetime('now')`
    )
    .run(params.runId, params.status, params.feedback ?? null)
}

export function createFactoryQuestion(
  this: OrchestrationDb,
  params: { runId: string; question: string }
): FactoryQuestionRow {
  const id = generateId('fq')
  this.db
    .prepare('INSERT INTO factory_questions (id, run_id, question) VALUES (?, ?, ?)')
    .run(id, params.runId, params.question)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: inserted on the line above.
  return this.getFactoryQuestion(id) as FactoryQuestionRow
}

export function getFactoryQuestion(
  this: OrchestrationDb,
  id: string
): FactoryQuestionRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_questions WHERE id = ?').get(id) as
    | FactoryQuestionRow
    | undefined
}

export function listFactoryQuestions(this: OrchestrationDb, runId: string): FactoryQuestionRow[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare('SELECT * FROM factory_questions WHERE run_id = ? ORDER BY asked_at, rowid')
    .all(runId) as FactoryQuestionRow[]
}

/** Only an open question takes an answer, so a double submit cannot overwrite the first. */
export function answerFactoryQuestion(this: OrchestrationDb, id: string, answer: string): boolean {
  return (
    this.db
      .prepare(
        `UPDATE factory_questions SET answer = ?, answered_at = datetime('now')
         WHERE id = ? AND answer IS NULL`
      )
      .run(answer, id).changes > 0
  )
}

export type FactoryRequestStoreMethods = {
  createFactoryRequest: typeof createFactoryRequest
  getFactoryRequest: typeof getFactoryRequest
  getFactoryRequestByRun: typeof getFactoryRequestByRun
  listFactoryRequests: typeof listFactoryRequests
  setFactoryRequestWorktree: typeof setFactoryRequestWorktree
  linkFactoryRequestRun: typeof linkFactoryRequestRun
  cancelFactoryRequest: typeof cancelFactoryRequest
  getFactoryPlanApproval: typeof getFactoryPlanApproval
  setFactoryPlanApproval: typeof setFactoryPlanApproval
  createFactoryQuestion: typeof createFactoryQuestion
  getFactoryQuestion: typeof getFactoryQuestion
  listFactoryQuestions: typeof listFactoryQuestions
  answerFactoryQuestion: typeof answerFactoryQuestion
}

export function attachFactoryRequestStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createFactoryRequest,
    getFactoryRequest,
    getFactoryRequestByRun,
    listFactoryRequests,
    setFactoryRequestWorktree,
    linkFactoryRequestRun,
    cancelFactoryRequest,
    getFactoryPlanApproval,
    setFactoryPlanApproval,
    createFactoryQuestion,
    getFactoryQuestion,
    listFactoryQuestions,
    answerFactoryQuestion
  })
}
