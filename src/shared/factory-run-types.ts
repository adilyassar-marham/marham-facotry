import type { FactoryVerifySummary } from './factory-types'

export const FACTORY_DEFAULT_MAX_WORKERS = 3
export const FACTORY_DEFAULT_MAX_FIX_ROUNDS = 3
export const FACTORY_MAX_WORKERS_CEILING = 16
export const FACTORY_MAX_FIX_ROUNDS_CEILING = 10

/** Whole-branch checks: `baseline` proves the base passes before planning; `integration` after a land. */
export type FactoryCheckKind = 'baseline' | 'integration'

export type FactoryCheckSummary = FactoryVerifySummary & {
  kind: FactoryCheckKind
  /** The integration branch commit the check ran on; a newer commit makes it stale. */
  headSha: string
}

export type FactoryReviewVerdict = 'pending' | 'pass' | 'fail'

export type FactoryReviewFinding = {
  rule: string
  file?: string
  line?: number
  problem: string
  fix?: string
}

export type FactoryReviewSummary = {
  id: string
  round: number
  taskId: string | null
  headSha: string
  verdict: FactoryReviewVerdict
  summary: string
  findings: FactoryReviewFinding[]
  /** Set when Orca failed the review itself (blocked paths), with no reviewer agent involved. */
  mechanical: boolean
  createdAt: string
  submittedAt: string | null
}

export type FactoryPullRequestInfo = {
  url: string
  number: number | null
  headBranch: string
  baseBranch: string
  headSha: string
  openedAt: string
}

/** Why the PR button is disabled, in the order a person should fix them. */
export type FactoryPrReadiness = { ready: boolean; reasons: string[] }

export type FactoryRunReport = {
  repoId: string | null
  baseBranch: string | null
  integrationBranch: string | null
  integrationWorktreePath: string | null
  maxWorkers: number
  maxFixRounds: number
  baseline: FactoryCheckSummary | null
  integration: FactoryCheckSummary | null
  reviews: FactoryReviewSummary[]
  fixRoundsUsed: number
  pullRequest: FactoryPullRequestInfo | null
  prReadiness: FactoryPrReadiness
  /** Gate refusals across every task of the run: how often work came back for fixes. */
  gateRefusals: number
}

export type FactoryRepoSettings = {
  /** Repo-relative guideline files the reviewer checks diffs against, read from the primary checkout. */
  guidelines: string[]
  maxWorkers: number
  maxFixRounds: number
}

export type FactoryBaselineResult = {
  runId: string
  integrationBranch: string
  integrationWorktreePath: string
  setup: { ran: boolean; ok: boolean; outputTail: string }
  check: FactoryCheckSummary | null
}

export type FactoryReviewStartResult =
  | {
      kind: 'reviewer_needed'
      runId: string
      round: number
      reviewTaskId: string
      headSha: string
      guidelines: string[]
      integrationBranch: string
    }
  | { kind: 'failed_mechanically'; runId: string; round: number; review: FactoryReviewSummary }
  | { kind: 'already_passed'; runId: string; review: FactoryReviewSummary }

export type FactoryCleanupResult = {
  runId: string
  removed: { taskId: string; worktreePath: string; branch: string | null }[]
  kept: { taskId: string; worktreePath: string; reason: string }[]
}

export type FactoryOpenPrResult =
  | { ok: true; pullRequest: FactoryPullRequestInfo }
  | { ok: false; pushed: boolean; error: string; compareUrl: string | null }
