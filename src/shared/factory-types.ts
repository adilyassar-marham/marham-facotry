import type { FactoryRepoSettings, FactoryRunReport } from './factory-run-types'

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
  | 'reviewed'
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
  /** Review tasks judge the integration branch; they are never gated or landed. */
  kind: 'build' | 'review'
}

export type FactoryBoard = {
  runId: string | null
  objective: string | null
  tasks: FactoryBoardTask[]
  /** Null for a run the factory never set up (no baseline, no land). */
  report: FactoryRunReport | null
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
  /** Saved policy, or defaults with auto-detected guideline files when never saved. */
  settings: FactoryRepoSettings
  /** Set when the gate runs the team's committed rules from this base ref (e.g. origin/master). */
  managedBaseRef: string | null
  /** Committed team rules found on the base branch, offered for one-click opt-in; IPC list only. */
  teamRules: { baseRef: string; verify: string; guidelines: string[] } | null
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
  /** The repo setup script, re-run in the integration worktree after new merges. */
  setup?: { ran: boolean; ok: boolean; outputTail: string } | null
}
