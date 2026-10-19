import type {
  FactoryBriefKind,
  FactoryBriefStatus
} from '../../../../../shared/factory-request-types'

export type FactoryVerifyStatus = 'running' | 'passed' | 'failed' | 'not_approved' | 'error'

export type FactoryTicketState = 'none' | 'open' | 'consumed' | 'superseded'

export type FactoryGateApprovalRow = {
  repo_id: string
  content_hash: string
  command: string
  timeout_seconds: number
  approved_at: string
}

export type FactoryVerifyResultRow = {
  id: string
  task_id: string
  dispatch_id: string | null
  worktree_id: string
  status: FactoryVerifyStatus
  ticket: FactoryTicketState
  exit_code: number | null
  timed_out: number
  duration_ms: number | null
  output_tail: string
  created_at: string
  completed_at: string | null
}

export type FactoryLandingRow = {
  run_id: string
  task_id: string
  integration_branch: string
  merge_commit: string
  landed_at: string
}

export type FactoryIntegrationRow = {
  run_id: string
  repo_id: string
  worktree_id: string
  worktree_path: string
  integration_branch: string
  created_at: string
}

export type FactoryTaskWorktree = { dispatch_id: string; worktree_id: string }

/** The worker worktree a Task's completion is judged against, when its repo has the gate on. */
export type FactoryGateTarget = {
  taskId: string
  dispatchId: string
  worktreeId: string
  repoId: string
  approval: FactoryGateApprovalRow
}

export type FactoryTicketConsumption =
  | { ok: true; gated: boolean }
  | { ok: false; code: 'factory_verify_required'; reason: string }

export type FactoryRunRow = {
  run_id: string
  repo_id: string
  base_branch: string | null
  base_sha: string | null
  max_workers: number
  max_fix_rounds: number
  created_at: string
}

export type FactoryCheckRow = {
  id: string
  run_id: string
  kind: 'baseline' | 'integration'
  head_sha: string
  status: 'passed' | 'failed' | 'not_approved' | 'error'
  exit_code: number | null
  timed_out: number
  duration_ms: number | null
  output_tail: string
  created_at: string
}

export type FactoryReviewRow = {
  id: string
  run_id: string
  round: number
  task_id: string | null
  head_sha: string
  verdict: 'pending' | 'pass' | 'fail'
  summary: string
  findings: string
  fix_task_id: string | null
  created_at: string
  submitted_at: string | null
}

export type FactoryPullRequestRow = {
  run_id: string
  url: string
  number: number | null
  head_branch: string
  base_branch: string
  head_sha: string
  opened_at: string
}

export type FactoryRepoSettingsRow = {
  repo_id: string
  guidelines: string
  max_workers: number
  max_fix_rounds: number
  updated_at: string
}

export type FactoryRequestRow = {
  id: string
  repo_id: string
  title: string
  description: string
  agent: string
  worktree_id: string | null
  run_id: string | null
  cancelled: number
  created_at: string
}

export type FactoryPlanApprovalRow = {
  run_id: string
  status: 'awaiting' | 'approved' | 'changes_requested'
  feedback: string | null
  updated_at: string
}

export type FactoryQuestionRow = {
  id: string
  run_id: string
  question: string
  answer: string | null
  asked_at: string
  answered_at: string | null
}

export type FactoryMessageRow = {
  id: string
  request_id: string
  author: 'agent' | 'requester'
  kind: 'say' | 'question' | 'answer' | 'brief'
  body: string
  created_at: string
}

export type FactoryRequestQuestionRow = {
  id: string
  request_id: string
  question: string
  choices_json: string
  recommended: number | null
  why: string | null
  answer: string | null
  asked_at: string
  answered_at: string | null
}

export type FactoryBriefRow = {
  request_id: string
  version: number
  person_md: string
  agent_md: string
  kind: FactoryBriefKind
  acceptance_json: string
  status: FactoryBriefStatus
  feedback: string | null
  created_at: string
}

export type FactoryRunConfigRow = {
  run_id: string
  base_ref: string
  base_commit: string
  verify: string
  setup: string | null
  guidelines: string
  max_workers: number | null
  max_fix_rounds: number | null
  created_at: string
}

export type FactoryRequestBaseRow = {
  request_id: string
  base_ref: string
  base_commit: string
  recorded_at: string
}

export type FactoryRunSkillPackRow = {
  run_id: string
  base_commit: string
  pack: string
  overlays: string
  budget_chars: number
}

export type FactoryRunSkillRow = {
  run_id: string
  stage: string
  skill: string
  sha256: string
  source: string
  pinned_commit: string
}

export type FactoryRunRiskPathRow = {
  run_id: string
  path: string
}
