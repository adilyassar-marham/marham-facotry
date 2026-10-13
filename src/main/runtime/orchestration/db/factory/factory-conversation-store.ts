import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import type {
  FactoryBriefRow,
  FactoryMessageRow,
  FactoryRequestQuestionRow
} from './factory-row-types'

export function insertFactoryMessage(
  this: OrchestrationDb,
  params: {
    requestId: string
    author: 'agent' | 'requester'
    kind: FactoryMessageRow['kind']
    body: string
  }
): FactoryMessageRow {
  const id = generateId('fmsg')
  this.db
    .prepare(
      `INSERT INTO factory_messages (id, request_id, author, kind, body) VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, params.requestId, params.author, params.kind, params.body)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: inserted on the line above.
  return this.db.prepare('SELECT * FROM factory_messages WHERE id = ?').get(id) as FactoryMessageRow
}

export function createFactoryRequestQuestion(
  this: OrchestrationDb,
  params: {
    requestId: string
    question: string
    choices: string[]
    recommended: number
    why: string
  }
): FactoryRequestQuestionRow {
  const id = generateId('frqq')
  this.db
    .prepare(
      `INSERT INTO factory_request_questions
         (id, request_id, question, choices_json, recommended, why)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.requestId,
      params.question,
      JSON.stringify(params.choices),
      params.recommended,
      params.why
    )
  const row = this.getFactoryRequestQuestion(id)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: inserted on the line above.
  return row as FactoryRequestQuestionRow
}

export function getFactoryRequestQuestion(
  this: OrchestrationDb,
  id: string
): FactoryRequestQuestionRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_request_questions WHERE id = ?').get(id) as
    | FactoryRequestQuestionRow
    | undefined
}

export function listFactoryRequestQuestions(
  this: OrchestrationDb,
  requestId: string
): FactoryRequestQuestionRow[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare(`SELECT * FROM factory_request_questions WHERE request_id = ? ORDER BY asked_at, id`)
    .all(requestId) as FactoryRequestQuestionRow[]
}

export function answerFactoryRequestQuestion(
  this: OrchestrationDb,
  id: string,
  answer: string
): boolean {
  const updated = this.db
    .prepare(
      `UPDATE factory_request_questions
       SET answer = ?, answered_at = datetime('now')
       WHERE id = ? AND answer IS NULL`
    )
    .run(answer, id)
  return updated.changes === 1
}

export function latestFactoryBrief(
  this: OrchestrationDb,
  requestId: string
): FactoryBriefRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare(`SELECT * FROM factory_briefs WHERE request_id = ? ORDER BY version DESC LIMIT 1`)
    .get(requestId) as FactoryBriefRow | undefined
}

export function insertFactoryBrief(
  this: OrchestrationDb,
  params: {
    requestId: string
    version: number
    person: string
    agent: string
    kind: FactoryBriefRow['kind']
    acceptanceJson: string
  }
): void {
  this.db
    .prepare(
      `INSERT INTO factory_briefs
         (request_id, version, person_md, agent_md, kind, acceptance_json, status)
       VALUES (?, ?, ?, ?, ?, ?, 'draft')`
    )
    .run(
      params.requestId,
      params.version,
      params.person,
      params.agent,
      params.kind,
      params.acceptanceJson
    )
}

export function replaceFactoryBriefDraft(
  this: OrchestrationDb,
  params: {
    requestId: string
    version: number
    person: string
    agent: string
    kind: FactoryBriefRow['kind']
    acceptanceJson: string
  }
): void {
  this.db
    .prepare(
      `UPDATE factory_briefs
       SET person_md = ?, agent_md = ?, kind = ?, acceptance_json = ?, status = 'draft', feedback = NULL
       WHERE request_id = ? AND version = ? AND status = 'draft'`
    )
    .run(
      params.person,
      params.agent,
      params.kind,
      params.acceptanceJson,
      params.requestId,
      params.version
    )
}

export function setFactoryBriefDecision(
  this: OrchestrationDb,
  params: {
    requestId: string
    version: number
    status: 'approved' | 'changes_requested'
    feedback: string | null
  }
): void {
  this.db
    .prepare(
      `UPDATE factory_briefs SET status = ?, feedback = ?
       WHERE request_id = ? AND version = ? AND status = 'draft'`
    )
    .run(params.status, params.feedback, params.requestId, params.version)
}

export type FactoryConversationStoreMethods = {
  insertFactoryMessage: typeof insertFactoryMessage
  createFactoryRequestQuestion: typeof createFactoryRequestQuestion
  getFactoryRequestQuestion: typeof getFactoryRequestQuestion
  listFactoryRequestQuestions: typeof listFactoryRequestQuestions
  answerFactoryRequestQuestion: typeof answerFactoryRequestQuestion
  latestFactoryBrief: typeof latestFactoryBrief
  insertFactoryBrief: typeof insertFactoryBrief
  replaceFactoryBriefDraft: typeof replaceFactoryBriefDraft
  setFactoryBriefDecision: typeof setFactoryBriefDecision
}

export function attachFactoryConversationStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    insertFactoryMessage,
    createFactoryRequestQuestion,
    getFactoryRequestQuestion,
    listFactoryRequestQuestions,
    answerFactoryRequestQuestion,
    latestFactoryBrief,
    insertFactoryBrief,
    replaceFactoryBriefDraft,
    setFactoryBriefDecision
  })
}
