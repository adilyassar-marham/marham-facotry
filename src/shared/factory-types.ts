export const FACTORY_VERIFY_DEFAULT_TIMEOUT_SECONDS = 600
export const FACTORY_VERIFY_MAX_TIMEOUT_SECONDS = 1800
// Why: a worker's `worker_done` blocks while verify runs, so the CLI socket must outlast the cap.
export const FACTORY_VERIFY_CLIENT_TIMEOUT_MS = (FACTORY_VERIFY_MAX_TIMEOUT_SECONDS + 60) * 1000

/** Where a Task sits on the factory line; derived, never stored. */
export type FactoryStage =
  | 'planned'
  | 'building'
  | 'verifying'
  | 'verify_failed'
  | 'review'
  | 'landed'
  | 'failed'
  | 'blocked'

export type FactoryVerifySummary = {
  id: string
  status: 'running' | 'passed' | 'failed' | 'not_approved' | 'error'
  exitCode: number | null
  timedOut: boolean
  durationMs: number | null
  outputTail: string
  completedAt: string | null
}

export type FactoryBoardTask = {
  taskId: string
  title: string
  status: string
  deps: string[]
  stage: FactoryStage
  verify: FactoryVerifySummary | null
  landedOn: string | null
}

export type FactoryBoard = {
  runId: string | null
  objective: string | null
  tasks: FactoryBoardTask[]
}

export type FactoryGateStatus = {
  repoId: string
  repoName: string
  /** Current `scripts.verify` in the primary checkout's orca.yaml, if any. */
  command: string | null
  enabled: boolean
  /** Enabled, but the command no longer matches what was approved: completions fail closed. */
  stale: boolean
  timeoutSeconds: number | null
  approvedAt: string | null
  /** Why the gate cannot be enabled here (remote repo, no verify script). */
  unsupportedReason: string | null
}

export type FactoryPlanTaskInput = {
  key: string
  title?: string
  spec: string
  acceptance?: string[]
  deps?: string[]
}

export type FactoryPlanApplyResult = {
  runId: string
  tasks: { key: string; taskId: string }[]
}

export type FactoryLandStep =
  | { taskId: string; outcome: 'merged'; mergeCommit: string }
  | { taskId: string; outcome: 'already_landed' }
  | { taskId: string; outcome: 'conflict'; files: string[] }

export type FactoryLandResult = {
  runId: string
  integrationBranch: string
  integrationWorktreePath: string
  steps: FactoryLandStep[]
  /** Tasks not yet eligible (not completed with a passing verify), in plan order. */
  skipped: { taskId: string; reason: string }[]
  stoppedOnConflict: boolean
  integrationVerify: FactoryVerifySummary | null
}
