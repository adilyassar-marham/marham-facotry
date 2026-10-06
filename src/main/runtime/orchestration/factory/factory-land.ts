import { runWithGitWorktreeOperationLock } from '../../../../shared/git-worktree-operation-lock'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { FactoryLandResult, FactoryLandStep } from '../../../../shared/factory-types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import type { FactoryIntegrationRow } from '../db/factory/factory-row-types'
import type {
  FactoryScriptRunner,
  FactoryVerifyHost,
  FactoryWorktreeTarget
} from './factory-verify'
import { selectFactoryLandCandidates, type FactoryLandCandidate } from './factory-land-selection'
import { countCommitsToMerge, runLocalGit, type FactoryGitRunner } from './factory-git'
import {
  ensureFactoryIntegration,
  runFactoryCheck,
  runFactorySetup,
  type FactoryIntegrationHost
} from './factory-integration'
import { summarizeFactoryCheck } from './factory-run-report'

export type FactoryLandHost = FactoryIntegrationHost
export type { FactoryGitRun, FactoryGitRunner } from './factory-git'

const normalizeBranch = (branch: string | null | undefined): string | undefined =>
  branch?.replace(/^refs\/heads\//, '') || undefined

async function requireLocalTarget(
  host: FactoryVerifyHost,
  worktreeId: string
): Promise<FactoryWorktreeTarget> {
  const target = await host.resolveFactoryWorktreeTarget(`id:${worktreeId}`)
  if (target.executionHostId !== LOCAL_EXECUTION_HOST_ID || !target.repo) {
    throw new OrchestrationError(
      'factory_land_unsupported_host',
      'Factory land merges on local and WSL repos only; this run’s worktrees are remote.'
    )
  }
  return target
}

async function mergeCandidate(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  git: FactoryGitRunner,
  integration: FactoryIntegrationRow,
  candidate: FactoryLandCandidate,
  wslDistro: string | undefined
): Promise<FactoryLandStep | { skip: string }> {
  const branch = normalizeBranch(
    (await requireLocalTarget(host, candidate.worktreeId)).worktree.branch
  )
  if (!branch) {
    return { skip: 'worker worktree is on a detached HEAD; nothing to merge' }
  }
  const cwd = integration.worktree_path
  const pending = await countCommitsToMerge(git, cwd, branch, wslDistro)
  if (pending === 0) {
    // Why: merging a branch with nothing new is a silent no-op that used to be reported as landed.
    return { skip: `branch ${branch} has no commits to land; the worker never committed its work` }
  }
  const message = `factory: land ${candidate.title} (${candidate.taskId})`
  const merge = await git(['merge', '--no-ff', '--no-edit', '-m', message, branch], cwd, wslDistro)
  if (!merge.ok) {
    const conflicted = await git(['diff', '--name-only', '--diff-filter=U'], cwd, wslDistro)
    // Why abort: a half-merged integration branch would poison every later land of this run.
    await git(['merge', '--abort'], cwd, wslDistro)
    const files = conflicted.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return { taskId: candidate.taskId, outcome: 'conflict', files }
  }
  const head = await git(['rev-parse', 'HEAD'], cwd, wslDistro)
  const mergeCommit = head.stdout.trim()
  db.recordFactoryLanding({
    runId: integration.run_id,
    taskId: candidate.taskId,
    integrationBranch: integration.integration_branch,
    mergeCommit
  })
  return { taskId: candidate.taskId, outcome: 'merged', mergeCommit }
}

/**
 * Merges verified Tasks onto `factory/<run>` in dependency order and never touches the base branch:
 * shipping the integration branch stays a human decision through the normal review flow.
 */
export async function landFactoryRun(
  db: OrchestrationDb,
  host: FactoryLandHost,
  params: { runId: string; baseBranch?: string },
  deps: { git?: FactoryGitRunner; runner?: FactoryScriptRunner } = {}
): Promise<FactoryLandResult> {
  const git = deps.git ?? runLocalGit
  db.requireRun(params.runId)
  const selection = selectFactoryLandCandidates(db, params.runId)
  const steps: FactoryLandStep[] = selection.alreadyLanded.map((taskId) => ({
    taskId,
    outcome: 'already_landed'
  }))
  const skipped = [...selection.skipped]
  const existing = db.getFactoryIntegration(params.runId)
  const result: FactoryLandResult = {
    runId: params.runId,
    integrationBranch: existing?.integration_branch ?? `factory/${params.runId}`,
    integrationWorktreePath: existing?.worktree_path ?? '',
    steps,
    skipped,
    stoppedOnConflict: false,
    integrationVerify: null
  }
  if (selection.candidates.length === 0) {
    return result
  }
  const repoIds = new Set(selection.candidates.map((candidate) => candidate.repoId))
  if (repoIds.size > 1) {
    throw new OrchestrationError(
      'factory_land_multi_repo',
      'This run’s tasks span several repos; factory land handles one repo per run.'
    )
  }
  const first = await requireLocalTarget(host, selection.candidates[0].worktreeId)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: requireLocalTarget refused a target without a repo.
  const repo = first.repo as NonNullable<FactoryWorktreeTarget['repo']>
  const factoryRun = db.getFactoryRun(params.runId)
  const { integration } = await ensureFactoryIntegration(
    db,
    host,
    {
      runId: params.runId,
      repo,
      baseBranch: params.baseBranch ?? factoryRun?.base_branch ?? undefined,
      wslDistro: first.wslDistro
    },
    // Why no setup on create: it runs once below, after the merges that may add dependencies.
    { runner: deps.runner, git, setupOnCreate: false }
  )
  result.integrationBranch = integration.integration_branch
  result.integrationWorktreePath = integration.worktree_path
  let merged = false
  await runWithGitWorktreeOperationLock(integration.worktree_path, undefined, async () => {
    for (const candidate of selection.candidates) {
      const step = await mergeCandidate(db, host, git, integration, candidate, first.wslDistro)
      if ('skip' in step) {
        skipped.push({ taskId: candidate.taskId, reason: step.skip })
        continue
      }
      steps.push(step)
      if (step.outcome === 'conflict') {
        result.stoppedOnConflict = true
        return
      }
      merged = true
    }
  })
  if (!merged) {
    return result
  }
  // Why setup first: merged work may add dependencies the integration worktree does not have yet.
  const setup = await runFactorySetup(repo, integration.worktree_path, first.wslDistro, deps.runner)
  result.setup = setup.ran ? setup : null
  const check = await runFactoryCheck(db, {
    runId: params.runId,
    kind: 'integration',
    repo,
    cwd: integration.worktree_path,
    wslDistro: first.wslDistro,
    runner: deps.runner,
    git
  })
  result.integrationVerify = check ? summarizeFactoryCheck(check) : null
  return result
}
