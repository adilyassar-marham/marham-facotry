import {
  FACTORY_DEFAULT_MAX_FIX_ROUNDS,
  FACTORY_DEFAULT_MAX_WORKERS,
  type FactoryCheckSummary,
  type FactoryPrReadiness,
  type FactoryReviewFinding,
  type FactoryReviewSmell,
  type FactoryReviewSummary,
  type FactoryRunReport
} from '../../../../shared/factory-run-types'
import type { OrchestrationDb } from '../db'
import type { FactoryCheckRow, FactoryReviewRow } from '../db/factory/factory-row-types'

export function summarizeFactoryCheck(row: FactoryCheckRow): FactoryCheckSummary {
  return {
    id: row.id,
    kind: row.kind,
    headSha: row.head_sha,
    status: row.status,
    exitCode: row.exit_code,
    timedOut: row.timed_out === 1,
    durationMs: row.duration_ms,
    outputTail: row.output_tail,
    completedAt: row.created_at
  }
}

function parseFindings(raw: string): FactoryReviewFinding[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: written only by parseFactoryReviewReport or the mechanical check, both validated.
    return Array.isArray(parsed) ? (parsed as FactoryReviewFinding[]) : []
  } catch {
    return []
  }
}

function storedSmells(raw: string): FactoryReviewSmell[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap((item) => {
      if (typeof item !== 'object' || item === null) {
        return []
      }
      const name = Object.getOwnPropertyDescriptor(item, 'name')?.value
      const note = Object.getOwnPropertyDescriptor(item, 'note')?.value
      const file = Object.getOwnPropertyDescriptor(item, 'file')?.value
      if (typeof name !== 'string') {
        return []
      }
      return [
        {
          name,
          note: typeof note === 'string' ? note : '',
          ...(typeof file === 'string' && file ? { file } : {})
        }
      ]
    })
  } catch {
    return []
  }
}

export function summarizeFactoryReview(row: FactoryReviewRow): FactoryReviewSummary {
  return {
    id: row.id,
    round: row.round,
    taskId: row.task_id,
    headSha: row.head_sha,
    verdict: row.verdict,
    summary: row.summary,
    findings: parseFindings(row.findings),
    mechanical: row.task_id === null,
    createdAt: row.created_at,
    submittedAt: row.submitted_at
  }
}

const OPEN_TASK_STATUSES = new Set(['pending', 'ready', 'dispatched', 'blocked'])

/**
 * What still stands between this run and a PR, from recorded state only. Opening the PR re-reads
 * the branch head, so a commit made behind Orca's back still cannot slip through.
 */
export function describeFactoryPrReadiness(db: OrchestrationDb, runId: string): FactoryPrReadiness {
  const reasons: string[] = []
  const run = db.getFactoryRun(runId)
  const integration = db.getFactoryIntegration(runId)
  if (!run || !integration) {
    return { ready: false, reasons: ['Run factory baseline and land at least one task first.'] }
  }
  const pullRequest = db.getFactoryPullRequest(runId)
  if (pullRequest) {
    return { ready: false, reasons: [`A pull request is already open: ${pullRequest.url}`] }
  }
  if (!db.getFactoryGateApproval(run.repo_id)) {
    reasons.push('Turn the quality gate on for this repo.')
  }
  const reviewIds = new Set(db.listFactoryReviews(runId).map((review) => review.task_id))
  const open = db
    .listTasks({ runId })
    .filter((task) => !reviewIds.has(task.id) && OPEN_TASK_STATUSES.has(task.status))
  if (open.length > 0) {
    reasons.push(`${open.length} task(s) are still open.`)
  }
  if (db.listFactoryLandings(runId).length === 0) {
    reasons.push('Nothing has landed on the integration branch yet.')
  }
  const check = db.getLatestFactoryCheck(runId, 'integration')
  if (!check) {
    reasons.push('The integration branch has not been verified yet.')
  } else if (check.status !== 'passed') {
    reasons.push('The integration branch fails verify.')
  }
  const decided = db.listFactoryReviews(runId).findLast((review) => review.verdict !== 'pending')
  if (!decided) {
    reasons.push('No guideline review has passed yet.')
  } else if (decided.verdict === 'fail') {
    reasons.push(`Review round ${decided.round} failed; fix its findings and review again.`)
  } else if (check && decided.head_sha !== check.head_sha) {
    reasons.push('The passing review is for an older commit; review the current branch.')
  }
  return { ready: reasons.length === 0, reasons }
}

/** Null for a run the factory never set up, so plain orchestration runs show no factory chrome. */
export function buildFactoryRunReport(db: OrchestrationDb, runId: string): FactoryRunReport | null {
  const run = db.getFactoryRun(runId)
  const integration = db.getFactoryIntegration(runId)
  if (!run && !integration) {
    return null
  }
  const reviews = db.listFactoryReviews(runId).map((row) => {
    const summary = summarizeFactoryReview(row)
    const smells = storedSmells(db.getFactoryReviewDetails(row.id)?.smells_json ?? '[]')
    return smells.length > 0 ? { ...summary, smells } : summary
  })
  const baseline = db.getLatestFactoryCheck(runId, 'baseline')
  const check = db.getLatestFactoryCheck(runId, 'integration')
  const pullRequest = db.getFactoryPullRequest(runId)
  const taskIds = db.listTasks({ runId }).map((task) => task.id)
  return {
    repoId: run?.repo_id ?? integration?.repo_id ?? null,
    baseBranch: run?.base_branch ?? null,
    integrationBranch: integration?.integration_branch ?? null,
    integrationWorktreePath: integration?.worktree_path ?? null,
    maxWorkers: run?.max_workers ?? FACTORY_DEFAULT_MAX_WORKERS,
    maxFixRounds: run?.max_fix_rounds ?? FACTORY_DEFAULT_MAX_FIX_ROUNDS,
    baseline: baseline ? summarizeFactoryCheck(baseline) : null,
    integration: check ? summarizeFactoryCheck(check) : null,
    reviews,
    fixRoundsUsed: reviews.filter((review) => review.verdict === 'fail').length,
    pullRequest: pullRequest
      ? {
          url: pullRequest.url,
          number: pullRequest.number,
          headBranch: pullRequest.head_branch,
          baseBranch: pullRequest.base_branch,
          headSha: pullRequest.head_sha,
          openedAt: pullRequest.opened_at
        }
      : null,
    prReadiness: describeFactoryPrReadiness(db, runId),
    gateRefusals: db.countFactoryGateRefusals(taskIds),
    skills: db.listFactoryRunSkills(runId).map((row) => ({
      stage: row.stage,
      skill: row.skill,
      sha256: row.sha256,
      source: row.source,
      pinnedCommit: row.pinned_commit
    }))
  }
}
