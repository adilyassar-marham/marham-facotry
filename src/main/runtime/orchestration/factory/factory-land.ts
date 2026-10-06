import { gitExecFileAsync } from '../../../git/runner'
import { gitOptionsForWorktree } from '../../../git/git-runtime-options'
import { runWithGitWorktreeOperationLock } from '../../../../shared/git-worktree-operation-lock'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type {
  FactoryLandResult,
  FactoryLandStep,
  FactoryVerifySummary
} from '../../../../shared/factory-types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import type { FactoryIntegrationRow } from '../db/factory/factory-row-types'
import type {
  FactoryScriptRunner,
  FactoryVerifyHost,
  FactoryWorktreeTarget
} from './factory-verify'
import { selectFactoryLandCandidates, type FactoryLandCandidate } from './factory-land-selection'
import { runFactoryIntegrationVerify } from './factory-integration-verify'

export type FactoryLandHost = FactoryVerifyHost & {
  createFactoryIntegrationWorktree(args: {
    repoId: string
    branch: string
    name: string
    baseBranch?: string
  }): Promise<{ id: string; path: string }>
}

export type FactoryGitRun = { ok: boolean; stdout: string; stderr: string }
export type FactoryGitRunner = (
  args: string[],
  cwd: string,
  wslDistro?: string
) => Promise<FactoryGitRun>

function readStream(error: unknown, key: 'stdout' | 'stderr'): string {
  if (typeof error === 'object' && error !== null && key in error) {
    const value: unknown = Object.getOwnPropertyDescriptor(error, key)?.value
    return typeof value === 'string' ? value : ''
  }
  return ''
}

const runLocalGit: FactoryGitRunner = async (args, cwd, wslDistro) => {
  try {
    const result = await gitExecFileAsync(args, gitOptionsForWorktree(cwd, { wslDistro }))
    return { ok: true, ...result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      stdout: readStream(error, 'stdout'),
      stderr: readStream(error, 'stderr') || message
    }
  }
}

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

async function ensureIntegration(
  db: OrchestrationDb,
  host: FactoryLandHost,
  params: { runId: string; repoId: string; baseBranch?: string }
): Promise<FactoryIntegrationRow> {
  const existing = db.getFactoryIntegration(params.runId)
  if (existing) {
    if (existing.repo_id !== params.repoId) {
      throw new OrchestrationError(
        'factory_land_multi_repo',
        'This run already lands into another repo.'
      )
    }
    return existing
  }
  const branch = `factory/${params.runId}`
  const created = await host.createFactoryIntegrationWorktree({
    repoId: params.repoId,
    branch,
    name: `factory-${params.runId}`,
    baseBranch: params.baseBranch
  })
  db.recordFactoryIntegration({
    runId: params.runId,
    repoId: params.repoId,
    worktreeId: created.id,
    worktreePath: created.path,
    integrationBranch: branch
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: recorded on the line above.
  return db.getFactoryIntegration(params.runId) as FactoryIntegrationRow
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
  const integration = await ensureIntegration(db, host, {
    runId: params.runId,
    repoId: selection.candidates[0].repoId,
    baseBranch: params.baseBranch
  })
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
  const verify: FactoryVerifySummary | null = merged
    ? await runFactoryIntegrationVerify(db, {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: requireLocalTarget refused a target without a repo.
        repo: first.repo as NonNullable<FactoryWorktreeTarget['repo']>,
        cwd: integration.worktree_path,
        wslDistro: first.wslDistro,
        runner: deps.runner
      })
    : null
  result.integrationVerify = verify
  return result
}
