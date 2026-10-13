import type { FactoryRunReport } from './factory-run-types'

/** Where a request is, in words a non-technical requester understands; derived, never stored. */
export type FactoryRequestStage =
  | 'intake'
  | 'awaiting_brief_approval'
  | 'starting'
  | 'setting_up'
  | 'question'
  | 'planning'
  | 'plan_approval'
  | 'building'
  | 'reviewing'
  | 'ready_for_pr'
  | 'pr_opened'
  | 'needs_engineer'
  | 'cancelled'

export type FactoryBriefKind =
  | 'app_only'
  | 'needs_backend'
  | 'app_and_backend'
  | 'needs_native'
  | 'not_feasible'

export type FactoryBriefStatus = 'draft' | 'approved' | 'changes_requested'

export type FactoryBriefInput = {
  person: string
  agent: string
  kind: FactoryBriefKind
  acceptance: string[]
}

export type FactoryPlanApprovalStatus = 'awaiting' | 'approved' | 'changes_requested'

export type FactoryRequestQuestion = {
  id: string
  question: string
  answer: string | null
  askedAt: string
  choices?: string[]
  /** 1-based index into choices. */
  recommended?: number | null
  why?: string | null
}

export type FactoryRequestPlanTask = {
  taskId: string
  title: string
  spec: string
  status: string
}

export type FactoryRequestView = {
  id: string
  repoId: string
  title: string
  description: string
  agent: string
  createdAt: string
  cancelled: boolean
  worktreeId: string | null
  runId: string | null
  stage: FactoryRequestStage
  /** Builds done / total, while building. */
  progress: { done: number; total: number } | null
  pendingQuestion: FactoryRequestQuestion | null
  answeredQuestions: FactoryRequestQuestion[]
  planApproval: FactoryPlanApprovalStatus | null
  planFeedback: string | null
  /** The tasks waiting for approval (or approved), in plan order. */
  plan: FactoryRequestPlanTask[]
  report: FactoryRunReport | null
}

export type FactoryRequestCreateResult = {
  requestId: string
  /** The coordinator's first message; the renderer launches the agent with it. */
  coordinatorPrompt: string
  workspaceName: string
}

export type FactoryRequestStartResult = {
  requestId: string
  worktreeId: string
}

export type FactoryAskResult =
  | { status: 'answered'; questionId: string; answer: string }
  | { status: 'waiting'; questionId: string }

export type FactoryApprovalWaitResult =
  | { status: 'approved'; feedback?: string }
  | { status: 'changes_requested'; feedback: string }
  | { status: 'awaiting' }
  | { status: 'not_required' }

export type FactoryBriefWaitResult =
  | { status: 'approved'; version: number; agent: string }
  | { status: 'changes_requested'; version: number; feedback: string }
  | { status: 'waiting'; version: number | null }

export const FACTORY_REQUEST_WAIT_DEFAULT_SECONDS = 240
export const FACTORY_REQUEST_WAIT_MAX_SECONDS = 600
/** Task result marking a planned task a revised plan replaced; it never lands or reaches the PR. */
export const FACTORY_SUPERSEDED_TASK_RESULT = 'factory:superseded'
