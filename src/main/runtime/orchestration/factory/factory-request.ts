import {
  FACTORY_REQUEST_WAIT_DEFAULT_SECONDS,
  FACTORY_REQUEST_WAIT_MAX_SECONDS,
  FACTORY_SUPERSEDED_TASK_RESULT,
  type FactoryApprovalWaitResult,
  type FactoryAskResult,
  type FactoryRequestCreateResult
} from '../../../../shared/factory-request-types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'

const MAX_TITLE = 120
const MAX_DESCRIPTION = 8000
const MAX_QUESTION = 1000

function slug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return base || 'change'
}

export function buildFactoryCoordinatorPrompt(params: {
  requestId: string
  title: string
  description: string
  agent: string
  cli: string
}): string {
  const { cli } = params
  return [
    'You are the coordinator for a Marham Factory request from a non-technical teammate.',
    'They will never read this terminal. Reach them ONLY through the Orca commands below.',
    '',
    `Request ${params.requestId}: ${params.title}`,
    params.description,
    '',
    `1. Run \`${cli} skills get factory\` and follow its "Request mode" section exactly.`,
    `2. Create the run, then baseline it with \`--request ${params.requestId}\`.`,
    `3. If anything is unclear, ask with \`${cli} factory ask --run <run> --question "..."\` ` +
      '(plain words, no code, at most 3 questions in total).',
    '4. Split the work into separate tasks, one agent each, then plan. You never write the product code.',
    `5. After \`${cli} factory plan\`, wait with \`${cli} factory await-approval --run <run>\`. ` +
      'Start workers only when it answers approved. If that approval includes notes, update the plan to include them, then start workers — do not ask again. On changes_requested, revise the plan and wait again.',
    `6. After approval, start every ready task at once with \`--agent ${params.agent}\`, ` +
      'each in its own worktree, up to the worker cap. A task that needs another waits until that one lands, then starts the same way. ' +
      'Each task spec includes the coding standards. Tell each worker those rules are mandatory, and to commit before worker_done.',
    'Rules: never push, never open the PR, never merge, never edit orca.yaml or guideline files.',
    'Stop when the factory board says the PR is ready, or when a person is needed.'
  ].join('\n')
}

export function createFactoryRequestRecord(
  db: OrchestrationDb,
  params: { repoId: string; title: unknown; description: unknown; agent: unknown; cli: string }
): FactoryRequestCreateResult {
  const title = typeof params.title === 'string' ? params.title.trim() : ''
  const description = typeof params.description === 'string' ? params.description.trim() : ''
  if (!title || title.length > MAX_TITLE) {
    throw new Error(`Give the request a title of 1-${MAX_TITLE} characters.`)
  }
  if (!description || description.length > MAX_DESCRIPTION) {
    throw new Error(`Describe the change in 1-${MAX_DESCRIPTION} characters.`)
  }
  if (typeof params.agent !== 'string' || !params.agent) {
    throw new Error('Choose an agent.')
  }
  const row = db.createFactoryRequest({
    repoId: params.repoId,
    title,
    description,
    agent: params.agent
  })
  return {
    requestId: row.id,
    workspaceName: `request-${slug(title)}-${row.id.slice(-4)}`,
    coordinatorPrompt: buildFactoryCoordinatorPrompt({
      requestId: row.id,
      title,
      description,
      agent: params.agent,
      cli: params.cli
    })
  }
}

/**
 * Runs before a requested run's plan is created. A plan waiting on the requester cannot be
 * replaced behind their back; a plan they sent back has its unstarted tasks retired first.
 */
export function prepareFactoryPlanForApproval(db: OrchestrationDb, runId: string): void {
  if (!db.getFactoryRequestByRun(runId)) {
    return
  }
  const approval = db.getFactoryPlanApproval(runId)
  if (approval?.status === 'awaiting') {
    throw new OrchestrationError(
      'factory_plan_awaiting_approval',
      `Run ${runId}'s plan is waiting for the requester. Run \`orca factory await-approval ` +
        `--run ${runId}\` instead of planning again.`
    )
  }
  const foldingNotes = approval?.status === 'approved' && Boolean(approval.feedback)
  if (approval?.status !== 'changes_requested' && !foldingNotes) {
    return
  }
  const reviewTasks = new Set(db.listFactoryReviews(runId).map((review) => review.task_id))
  for (const task of db.listTasks({ runId })) {
    if (!reviewTasks.has(task.id) && (task.status === 'pending' || task.status === 'ready')) {
      db.updateTaskStatus(task.id, 'failed', FACTORY_SUPERSEDED_TASK_RESULT)
    }
  }
  if (foldingNotes) {
    db.setFactoryPlanApproval({ runId, status: 'approved', feedback: null })
  }
}

/** After a requested run's plan exists: the requester must approve it before any worker starts. */
export function markFactoryPlanAwaitingApproval(db: OrchestrationDb, runId: string): void {
  if (!db.getFactoryRequestByRun(runId)) {
    return
  }
  if (db.getFactoryPlanApproval(runId)?.status !== 'approved') {
    db.setFactoryPlanApproval({ runId, status: 'awaiting' })
  }
}

function clampWaitSeconds(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) || value < 0
    ? FACTORY_REQUEST_WAIT_DEFAULT_SECONDS
    : Math.min(Math.floor(value), FACTORY_REQUEST_WAIT_MAX_SECONDS)
}

/** Polls the database, which a renderer IPC write updates, until `done` answers or time runs out. */
async function pollUntil<T>(
  waitSeconds: number,
  read: () => T | null,
  signal?: AbortSignal
): Promise<T | null> {
  const deadline = Date.now() + waitSeconds * 1000
  for (;;) {
    const value = read()
    if (value !== null || Date.now() >= deadline || signal?.aborted) {
      return value
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

function requireRequestedRun(db: OrchestrationDb, runId: string): void {
  db.requireRun(runId)
  if (!db.getFactoryRequestByRun(runId)) {
    throw new OrchestrationError(
      'factory_not_a_request',
      `Run ${runId} was not started from a request, so there is no requester to ask. ` +
        'Link it with `orca factory baseline --run <run> --request <request-id>`.'
    )
  }
}

export async function askFactoryRequester(
  db: OrchestrationDb,
  params: { runId: string; question?: string; questionId?: string; waitSeconds?: number },
  signal?: AbortSignal
): Promise<FactoryAskResult> {
  requireRequestedRun(db, params.runId)
  let questionId = params.questionId
  if (questionId) {
    if (db.getFactoryQuestion(questionId)?.run_id !== params.runId) {
      throw new OrchestrationError('factory_question_not_found', 'No such question on this run.')
    }
  } else {
    const text = params.question?.trim() ?? ''
    if (!text || text.length > MAX_QUESTION) {
      throw new OrchestrationError(
        'invalid_argument',
        `Ask one plain-language question of 1-${MAX_QUESTION} characters.`
      )
    }
    if (db.listFactoryQuestions(params.runId).length >= 3) {
      throw new OrchestrationError(
        'factory_question_limit',
        'You already asked 3 questions. Plan with what you know and note assumptions in the plan.'
      )
    }
    questionId = db.createFactoryQuestion({ runId: params.runId, question: text }).id
  }
  const id = questionId
  const answer = await pollUntil(
    clampWaitSeconds(params.waitSeconds),
    () => db.getFactoryQuestion(id)?.answer ?? null,
    signal
  )
  return answer === null
    ? { status: 'waiting', questionId: id }
    : { status: 'answered', questionId: id, answer }
}

export async function awaitFactoryPlanApproval(
  db: OrchestrationDb,
  params: { runId: string; waitSeconds?: number },
  signal?: AbortSignal
): Promise<FactoryApprovalWaitResult> {
  db.requireRun(params.runId)
  if (!db.getFactoryRequestByRun(params.runId)) {
    return { status: 'not_required' }
  }
  const decided = await pollUntil(
    clampWaitSeconds(params.waitSeconds),
    () => {
      const approval = db.getFactoryPlanApproval(params.runId)
      return approval && approval.status !== 'awaiting' ? approval : null
    },
    signal
  )
  if (!decided) {
    return { status: 'awaiting' }
  }
  if (decided.status === 'approved') {
    return decided.feedback
      ? { status: 'approved', feedback: decided.feedback }
      : { status: 'approved' }
  }
  return { status: 'changes_requested', feedback: decided.feedback ?? '' }
}

/** Renderer-IPC only: approving work is the requester's call, never an agent's. */
export function decideFactoryPlan(
  db: OrchestrationDb,
  params: { runId: string; approve: boolean; feedback?: unknown }
): void {
  const approval = db.getFactoryPlanApproval(params.runId)
  if (approval?.status !== 'awaiting') {
    throw new Error('This plan is not waiting for a decision.')
  }
  const feedback = typeof params.feedback === 'string' ? params.feedback.trim() : ''
  if (!params.approve && !feedback) {
    throw new Error('Say what should change in the plan.')
  }
  db.setFactoryPlanApproval({
    runId: params.runId,
    status: params.approve ? 'approved' : 'changes_requested',
    feedback: feedback || null
  })
}
