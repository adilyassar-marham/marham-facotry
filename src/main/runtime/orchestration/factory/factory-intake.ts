import type {
  FactoryAskResult,
  FactoryBriefInput,
  FactoryBriefWaitResult
} from '../../../../shared/factory-request-types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import type { FactoryRequestRow } from '../db/factory/factory-row-types'
import { clampFactoryWaitSeconds, pollFactoryWait } from './factory-request'

const MAX_TEXT = 4000
const MAX_QUESTION = 1000
const MAX_WHY = 300
const MAX_CHOICE = 120
const MAX_BRIEF = 20000
const MAX_ACCEPTANCE = 30
const MAX_QUESTIONS = 12
const MIN_CHOICES = 2
const MAX_CHOICES = 4

function requireOpenRequest(db: OrchestrationDb, requestId: string): FactoryRequestRow {
  const request = db.getFactoryRequest(requestId)
  if (!request) {
    throw new OrchestrationError(
      'factory_request_not_found',
      `No request ${requestId}. Use the request id from your first message.`
    )
  }
  if (request.cancelled) {
    throw new OrchestrationError(
      'factory_request_cancelled',
      `Request ${requestId} was cancelled. Stop.`
    )
  }
  return request
}

function requireText(value: string | undefined, max: number, label: string): string {
  const text = value?.trim() ?? ''
  if (!text || text.length > max) {
    throw new OrchestrationError('invalid_argument', `${label} must be 1-${max} characters.`)
  }
  return text
}

export function sayFactoryRequest(
  db: OrchestrationDb,
  params: { requestId: string; text: string }
): void {
  requireOpenRequest(db, params.requestId)
  const body = requireText(params.text, MAX_TEXT, 'The message')
  db.insertFactoryMessage({ requestId: params.requestId, author: 'agent', kind: 'say', body })
}

export async function askFactoryRequest(
  db: OrchestrationDb,
  params: {
    requestId: string
    question?: string
    questionId?: string
    choices?: string[]
    recommended?: number
    why?: string
    waitSeconds?: number
  },
  signal?: AbortSignal
): Promise<FactoryAskResult> {
  requireOpenRequest(db, params.requestId)
  let questionId = params.questionId
  if (questionId) {
    if (db.getFactoryRequestQuestion(questionId)?.request_id !== params.requestId) {
      throw new OrchestrationError(
        'factory_question_not_found',
        'No such question on this request.'
      )
    }
  } else {
    const question = requireText(params.question, MAX_QUESTION, 'The question')
    const choices = (params.choices ?? []).map((choice) => choice.trim()).filter(Boolean)
    if (
      choices.length < MIN_CHOICES ||
      choices.length > MAX_CHOICES ||
      choices.some((choice) => choice.length > MAX_CHOICE)
    ) {
      throw new OrchestrationError(
        'invalid_argument',
        `Give ${MIN_CHOICES}-${MAX_CHOICES} choices, each at most ${MAX_CHOICE} characters.`
      )
    }
    const recommended = params.recommended
    if (
      recommended === undefined ||
      !Number.isInteger(recommended) ||
      recommended < 1 ||
      recommended > choices.length
    ) {
      throw new OrchestrationError(
        'invalid_argument',
        'recommended is the choice number to suggest, starting at 1.'
      )
    }
    const why = requireText(params.why, MAX_WHY, 'The reason')
    if (db.listFactoryRequestQuestions(params.requestId).length >= MAX_QUESTIONS) {
      throw new OrchestrationError(
        'factory_question_limit',
        'You already asked 12 questions. Write the brief and state your assumptions.'
      )
    }
    questionId = db.createFactoryRequestQuestion({
      requestId: params.requestId,
      question,
      choices,
      recommended,
      why
    }).id
    db.insertFactoryMessage({
      requestId: params.requestId,
      author: 'agent',
      kind: 'question',
      body: question
    })
  }
  const id = questionId
  const answer = await pollFactoryWait(
    clampFactoryWaitSeconds(params.waitSeconds),
    () => db.getFactoryRequestQuestion(id)?.answer ?? null,
    signal
  )
  return answer === null
    ? { status: 'waiting', questionId: id }
    : { status: 'answered', questionId: id, answer }
}

function relativeFactPath(entry: string): string | null {
  const path = entry.trim().replace(/\\/g, '/')
  if (!path || path.startsWith('/') || path.split('/').includes('..')) {
    return null
  }
  return path
}

function requireBrief(brief: FactoryBriefInput): FactoryBriefInput {
  const files: string[] = []
  for (const entry of brief.files ?? []) {
    const path = relativeFactPath(entry)
    if (path && !files.includes(path)) {
      files.push(path)
    }
  }
  return {
    person: requireText(brief.person, MAX_BRIEF, 'The person summary'),
    agent: requireText(brief.agent, MAX_BRIEF, 'The build brief'),
    kind: brief.kind,
    acceptance: brief.acceptance.map((item) => item.trim()).filter(Boolean),
    ...(brief.triage === 'bug' ? { triage: 'bug' } : {}),
    files,
    ...(brief.newModule === true ? { newModule: true } : {})
  }
}

export function submitFactoryBrief(
  db: OrchestrationDb,
  params: { requestId: string; brief: FactoryBriefInput }
): { requestId: string; version: number } {
  requireOpenRequest(db, params.requestId)
  const brief = requireBrief(params.brief)
  if (brief.acceptance.length < 1 || brief.acceptance.length > MAX_ACCEPTANCE) {
    throw new OrchestrationError(
      'invalid_argument',
      `The brief needs 1-${MAX_ACCEPTANCE} acceptance checks.`
    )
  }
  const acceptanceJson = JSON.stringify(brief.acceptance)
  const latest = db.latestFactoryBrief(params.requestId)
  if (latest?.status === 'approved') {
    throw new OrchestrationError(
      'factory_brief_already_approved',
      `Request ${params.requestId} already has an approved brief. Build that. Do not submit another.`
    )
  }
  const version = latest?.status === 'draft' ? latest.version : (latest?.version ?? 0) + 1
  const stored = {
    requestId: params.requestId,
    version,
    person: brief.person,
    agent: brief.agent,
    kind: brief.kind,
    acceptanceJson
  }
  if (latest?.status === 'draft') {
    db.replaceFactoryBriefDraft(stored)
  } else {
    db.insertFactoryBrief(stored)
  }
  db.recordFactoryBriefFacts({
    request_id: params.requestId,
    version,
    triage: brief.triage ?? null,
    files_json: JSON.stringify(brief.files ?? []),
    new_module: brief.newModule === true ? 1 : 0
  })
  db.insertFactoryMessage({
    requestId: params.requestId,
    author: 'agent',
    kind: 'brief',
    body: brief.person
  })
  return { requestId: params.requestId, version }
}

export async function awaitFactoryBrief(
  db: OrchestrationDb,
  params: { requestId: string; waitSeconds?: number },
  signal?: AbortSignal
): Promise<FactoryBriefWaitResult> {
  requireOpenRequest(db, params.requestId)
  const decided = await pollFactoryWait(
    clampFactoryWaitSeconds(params.waitSeconds),
    () => {
      const brief = db.latestFactoryBrief(params.requestId)
      return brief && brief.status !== 'draft' ? brief : null
    },
    signal
  )
  if (!decided) {
    return { status: 'waiting', version: db.latestFactoryBrief(params.requestId)?.version ?? null }
  }
  if (decided.status === 'approved') {
    return { status: 'approved', version: decided.version, agent: decided.agent_md }
  }
  return {
    status: 'changes_requested',
    version: decided.version,
    feedback: decided.feedback ?? ''
  }
}

/** Renderer-IPC only: approving a brief is the requester's call, never an agent's. */
export function decideFactoryBrief(
  db: OrchestrationDb,
  params: { requestId: string; approve: boolean; feedback?: unknown }
): void {
  const latest = db.latestFactoryBrief(params.requestId)
  if (latest?.status !== 'draft') {
    throw new Error('This brief is not waiting for a decision.')
  }
  const feedback = typeof params.feedback === 'string' ? params.feedback.trim() : ''
  if (!params.approve && !feedback) {
    throw new Error('Say what should change.')
  }
  db.setFactoryBriefDecision({
    requestId: params.requestId,
    version: latest.version,
    status: params.approve ? 'approved' : 'changes_requested',
    feedback: feedback || null
  })
}

/** Answers either a request question or a run question. Request answers are also chat messages. */
export function answerRequesterQuestion(
  db: OrchestrationDb,
  questionId: string,
  answer: string
): boolean {
  const requestQuestion = db.getFactoryRequestQuestion(questionId)
  if (requestQuestion) {
    if (!db.answerFactoryRequestQuestion(questionId, answer)) {
      return false
    }
    db.insertFactoryMessage({
      requestId: requestQuestion.request_id,
      author: 'requester',
      kind: 'answer',
      body: answer
    })
    return true
  }
  return db.answerFactoryQuestion(questionId, answer)
}
