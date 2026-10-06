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
