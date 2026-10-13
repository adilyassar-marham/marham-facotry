import type {
  FactoryApprovalWaitResult,
  FactoryAskResult,
  FactoryBriefWaitResult
} from '../shared/factory-request-types'
import type {
  FactoryBaselineResult,
  FactoryCheckSummary,
  FactoryCleanupResult,
  FactoryReviewFinding,
  FactoryReviewStartResult,
  FactoryRunReport
} from '../shared/factory-run-types'

const short = (sha: string): string => sha.slice(0, 10)

function formatCheck(label: string, check: FactoryCheckSummary | null): string {
  return check
    ? `${label}: ${check.status.toUpperCase()} at ${short(check.headSha)}`
    : `${label}: not run (quality gate off)`
}

function formatFinding(finding: FactoryReviewFinding): string {
  const where = finding.file ? ` ${finding.file}${finding.line ? `:${finding.line}` : ''}` : ''
  return `  - [${finding.rule}]${where} ${finding.problem}`
}

export function formatFactoryBaseline(result: FactoryBaselineResult): string {
  const lines = [
    `Integration branch ${result.integrationBranch} (${result.integrationWorktreePath})`,
    result.setup.ran
      ? `Setup: ${result.setup.ok ? 'OK' : 'FAILED'}`
      : 'Setup: none configured for this repo',
    formatCheck('Baseline verify', result.check)
  ]
  if (result.check && result.check.status !== 'passed') {
    lines.push(
      'The base already fails verify. Plan ONE root task that makes it pass; every other task',
      'depends on it.',
      result.check.outputTail.trim()
    )
  }
  return lines.join('\n')
}

export function formatFactoryReviewStart(result: FactoryReviewStartResult): string {
  if (result.kind === 'already_passed') {
    return `Review round ${result.review.round} already passed for this commit. The PR is the person's call.`
  }
  if (result.kind === 'failed_mechanically') {
    return [
      `Review round ${result.round} FAILED before any reviewer ran: ${result.review.summary}`,
      ...result.review.findings.map(formatFinding),
      `Next: orca factory fix --run ${result.runId}`
    ].join('\n')
  }
  return [
    `Review round ${result.round}: task ${result.reviewTaskId} on ${result.integrationBranch} at ${short(result.headSha)}`,
    `Guidelines: ${result.guidelines.length > 0 ? result.guidelines.join(', ') : '(none configured)'}`,
    'Start a fresh reviewer (never a worker that built this run):',
    `  orca orchestration worker-start --task ${result.reviewTaskId} --worktree new-child --base-branch ${result.integrationBranch} --setup skip --run ${result.runId}`
  ].join('\n')
}

export function formatFactoryFix(result: {
  runId: string
  round: number
  fixTaskId: string
  integrationBranch: string
}): string {
  return [
    `Fix task ${result.fixTaskId} for review round ${result.round}. Start it from the integration branch:`,
    `  orca orchestration worker-start --task ${result.fixTaskId} --worktree new-child --base-branch ${result.integrationBranch} --setup run --run ${result.runId}`,
    'When it completes: orca factory land, then orca factory review.'
  ].join('\n')
}

export function formatFactoryCleanup(result: FactoryCleanupResult): string {
  return [
    `Removed ${result.removed.length} worktree(s), kept ${result.kept.length}.`,
    ...result.removed.map(
      (entry) =>
        `  removed  ${entry.worktreePath}${entry.branch ? ` (branch ${entry.branch})` : ''}`
    ),
    ...result.kept.map((entry) => `  kept     ${entry.worktreePath}  ${entry.reason}`)
  ].join('\n')
}

export function formatFactoryRunReport(report: FactoryRunReport): string[] {
  const latestReview = report.reviews.at(-1)
  return [
    `Integration: ${report.integrationBranch ?? '(none yet)'}  · workers ≤ ${report.maxWorkers}`,
    formatCheck('  Baseline', report.baseline),
    formatCheck('  Integration verify', report.integration),
    latestReview
      ? `  Review round ${latestReview.round}: ${latestReview.verdict.toUpperCase()}  (fix rounds used ${report.fixRoundsUsed}/${report.maxFixRounds})`
      : '  Review: not started',
    `  Gate refusals so far: ${report.gateRefusals}`,
    report.pullRequest
      ? `  PR: ${report.pullRequest.url}`
      : report.prReadiness.ready
        ? '  PR: ready — a person opens it from Settings → Orchestration → Software factory'
        : `  PR: not ready — ${report.prReadiness.reasons.join(' ')}`
  ]
}

export function formatFactoryAsk(
  result: FactoryAskResult,
  scope: 'run' | 'request' = 'run'
): string {
  if (result.status === 'answered') {
    return `Answer: ${result.answer}`
  }
  const retry =
    scope === 'request'
      ? `orca factory ask --request <request> --question-id ${result.questionId}`
      : `orca factory ask --run <run> --question-id ${result.questionId}`
  return `No answer yet. Keep waiting: ${retry}`
}

export function formatFactoryBriefSaved(result: { requestId: string; version: number }): string {
  return (
    `Brief v${result.version} saved. Wait for the person: ` +
    `orca factory await-brief --request ${result.requestId}`
  )
}

export function formatFactoryAwaitBrief(result: FactoryBriefWaitResult): string {
  switch (result.status) {
    case 'approved':
      return `APPROVED. Build exactly this, not the person's original words:\n${result.agent}`
    case 'changes_requested':
      return `CHANGES. Revise the brief and submit it again:\n${result.feedback}`
    case 'waiting':
      return 'Still waiting for the person to approve the brief. Run await-brief again.'
  }
}

export function formatFactoryAwaitApproval(result: FactoryApprovalWaitResult): string {
  switch (result.status) {
    case 'approved':
      return result.feedback
        ? `APPROVED. Update the plan so it includes this, then start the workers. Do not ask for approval again:\n${result.feedback}`
        : 'APPROVED. Start the workers.'
    case 'changes_requested':
      return `CHANGES REQUESTED. Revise the plan and run factory plan again:\n${result.feedback}`
    case 'awaiting':
      return 'Still waiting for the requester. Run await-approval again.'
    case 'not_required':
      return 'This run has no requester; no approval is needed.'
  }
}
