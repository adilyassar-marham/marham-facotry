import type { FactoryReviewStartResult } from '../../../../shared/factory-run-types'
import type { Repo } from '../../../../shared/repo-types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import type { FactoryIntegrationRow, FactoryRunRow } from '../db/factory/factory-row-types'
import {
  countChangedLines,
  listChangedFiles,
  readHeadSha,
  runLocalGit,
  type FactoryGitRunner
} from './factory-git'
import { extractRunGuidelines } from './factory-managed-config'
import { resolveFactoryRepoSettings, resolveGuidelineFiles } from './factory-repo-settings'
import {
  buildFactoryFixSpec,
  buildFactoryReviewSpec,
  findBlockedPaths
} from './factory-review-spec'
import { summarizeFactoryReview } from './factory-run-report'
import { findingsRepeat } from './factory-skill-conditions'
import {
  skillProtectedRoots,
  skillSectionForFix,
  skillSectionForReview
} from './factory-skill-binding'
import type { FactoryVerifyHost } from './factory-verify'

type ReviewContext = {
  run: FactoryRunRow
  integration: FactoryIntegrationRow
  repo: Repo
  wslDistro?: string
}

async function loadReviewContext(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  runId: string
): Promise<ReviewContext> {
  const run = db.getFactoryRun(runId)
  const integration = db.getFactoryIntegration(runId)
  if (!run || !integration) {
    throw new OrchestrationError(
      'factory_baseline_required',
      `Run ${runId} has no factory integration branch. Run factory baseline and land work first.`
    )
  }
  const target = await host.resolveFactoryWorktreeTarget(`id:${integration.worktree_id}`)
  if (!target.repo) {
    throw new OrchestrationError('factory_land_unsupported_host', 'The integration repo is gone.')
  }
  return { run, integration, repo: target.repo, wslDistro: target.wslDistro }
}

/** Repo-relative guideline paths, and the trusted files the reviewer reads them from. */
async function resolveRunGuidelines(
  db: OrchestrationDb,
  params: { runId: string; repo: Repo },
  git: FactoryGitRunner
): Promise<{ paths: string[]; files: string[] }> {
  const managed = await extractRunGuidelines(db, params, git)
  if (managed) {
    return managed
  }
  const paths = resolveFactoryRepoSettings(db, params.repo).guidelines
  return { paths, files: resolveGuidelineFiles(params.repo, paths).present }
}

function landedTaskSpecs(db: OrchestrationDb, runId: string): { title: string; spec: string }[] {
  const landed = new Set(db.listFactoryLandings(runId).map((landing) => landing.task_id))
  return db
    .listTasks({ runId })
    .filter((task) => landed.has(task.id))
    .map((task) => ({ title: task.task_title ?? task.id, spec: task.spec }))
}

/**
 * Opens the next review round for the integration branch head. Blocked paths fail the round here,
 * with no agent involved; otherwise a review task is created for a fresh reviewer worker.
 */
export async function startFactoryReview(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  params: { runId: string },
  deps: { git?: FactoryGitRunner } = {}
): Promise<FactoryReviewStartResult> {
  const git = deps.git ?? runLocalGit
  const { run, integration, repo, wslDistro } = await loadReviewContext(db, host, params.runId)
  const cwd = integration.worktree_path
  const headSha = await readHeadSha(git, cwd, wslDistro)
  const check = db.getLatestFactoryCheck(params.runId, 'integration')
  if (!headSha || !check || check.status !== 'passed' || check.head_sha !== headSha) {
    throw new OrchestrationError(
      'factory_review_needs_green_branch',
      'Review runs only on an integration branch whose current commit passed verify. ' +
        'Run factory land (it verifies after merging) and fix any failure first.'
    )
  }
  const reviews = db.listFactoryReviews(params.runId)
  const latest = reviews.at(-1)
  if (latest?.head_sha === headSha && latest.verdict === 'pass') {
    return { kind: 'already_passed', runId: params.runId, review: summarizeFactoryReview(latest) }
  }
  const guidelines = await resolveRunGuidelines(db, { runId: params.runId, repo }, git)
  const openTask =
    latest?.verdict === 'pending' && latest.task_id ? db.getTask(latest.task_id) : null
  if (latest && openTask && latest.head_sha === headSha && openTask.status !== 'failed') {
    return {
      kind: 'reviewer_needed',
      runId: params.runId,
      round: latest.round,
      reviewTaskId: openTask.id,
      headSha,
      guidelines: guidelines.files,
      integrationBranch: integration.integration_branch
    }
  }
  const failures = reviews.filter((review) => review.verdict === 'fail').length
  if (failures > run.max_fix_rounds) {
    throw new OrchestrationError(
      'factory_needs_human',
      `${failures} review rounds failed, over this run's limit of ${run.max_fix_rounds} fix ` +
        'rounds. Stop and hand the branch and the findings to a person.'
    )
  }
  const round = reviews.filter((review) => review.verdict !== 'pending').length + 1
  const baseSha = run.base_sha ?? headSha
  const changed = (await listChangedFiles(git, cwd, baseSha, wslDistro)) ?? []
  const changedLines = await countChangedLines(git, cwd, baseSha, wslDistro)
  const blocked = findBlockedPaths(changed, guidelines.paths, skillProtectedRoots(db, params.runId))
  if (blocked.length > 0) {
    const review = db.createFactoryReview({
      runId: params.runId,
      round,
      taskId: null,
      headSha,
      verdict: 'fail',
      summary: 'Orca blocked this branch: it changes files a factory PR must never contain.',
      findings: JSON.stringify(blocked)
    })
    return {
      kind: 'failed_mechanically',
      runId: params.runId,
      round,
      review: summarizeFactoryReview(review)
    }
  }
  const previous = reviews.findLast((review) => review.verdict === 'fail')
  const skillsSection = await skillSectionForReview(
    db,
    repo,
    { runId: params.runId, changedFiles: changed, changedLines },
    git
  )
  const spec = buildFactoryReviewSpec({
    runId: params.runId,
    round,
    integrationBranch: integration.integration_branch,
    headSha,
    baseSha,
    guidelineFiles: guidelines.files,
    taskSpecs: landedTaskSpecs(db, params.runId),
    previousFindings: previous ? summarizeFactoryReview(previous).findings : [],
    skillsSection
  })
  db.db.exec('SAVEPOINT factory_review_start')
  try {
    const task = db.createTask({
      runId: params.runId,
      spec,
      taskTitle: `Guideline review, round ${round}`
    })
    db.createFactoryReview({ runId: params.runId, round, taskId: task.id, headSha })
    db.db.exec('RELEASE factory_review_start')
    return {
      kind: 'reviewer_needed',
      runId: params.runId,
      round,
      reviewTaskId: task.id,
      headSha,
      guidelines: guidelines.files,
      integrationBranch: integration.integration_branch
    }
  } catch (error) {
    db.db.exec('ROLLBACK TO factory_review_start')
    db.db.exec('RELEASE factory_review_start')
    throw error
  }
}

/** One fix task per failed round, built from that round's findings so nothing is paraphrased away. */
export async function createFactoryFixTask(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  params: { runId: string }
): Promise<{ runId: string; round: number; fixTaskId: string; integrationBranch: string }> {
  const { run, integration, repo } = await loadReviewContext(db, host, params.runId)
  const decided = db
    .listFactoryReviews(params.runId)
    .filter((review) => review.verdict !== 'pending')
  const failed = decided.at(-1)
  const failures = decided.filter((review) => review.verdict === 'fail').length
  if (failures > run.max_fix_rounds) {
    throw new OrchestrationError(
      'factory_needs_human',
      `This run used all ${run.max_fix_rounds} fix rounds. Hand the findings to a person.`
    )
  }
  if (!failed || failed.verdict !== 'fail') {
    throw new OrchestrationError(
      'factory_no_failed_review',
      'The latest decided review did not fail, so there is nothing to fix.'
    )
  }
  if (failed.fix_task_id) {
    throw new OrchestrationError(
      'factory_fix_exists',
      `Review round ${failed.round} already has fix task ${failed.fix_task_id}.`
    )
  }
  const guidelines = await resolveRunGuidelines(db, { runId: params.runId, repo }, runLocalGit)
  const findings = summarizeFactoryReview(failed).findings
  const prior = decided
    .filter((review) => review.verdict === 'fail')
    .slice(0, -1)
    .at(-1)
  const skillsSection = await skillSectionForFix(db, repo, {
    runId: params.runId,
    changedFiles: [],
    changedLines: 0,
    fixRepeat: prior ? findingsRepeat(summarizeFactoryReview(prior).findings, findings) : false
  })
  const spec = buildFactoryFixSpec({
    round: failed.round,
    integrationBranch: integration.integration_branch,
    guidelineFiles: guidelines.files,
    findings,
    skillsSection
  })
  const task = db.createTask({
    runId: params.runId,
    spec,
    taskTitle: `Fix review round ${failed.round} findings`
  })
  db.linkFactoryReviewFix(failed.id, task.id)
  return {
    runId: params.runId,
    round: failed.round,
    fixTaskId: task.id,
    integrationBranch: integration.integration_branch
  }
}
