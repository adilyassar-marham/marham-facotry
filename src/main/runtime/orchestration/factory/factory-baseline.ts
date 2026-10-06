import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { FactoryBaselineResult } from '../../../../shared/factory-run-types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import { runLocalGit, type FactoryGitRunner } from './factory-git'
import {
  ensureFactoryIntegration,
  runFactoryCheck,
  runFactorySetup,
  type FactoryIntegrationHost
} from './factory-integration'
import { resolveFactoryRepoSettings } from './factory-repo-settings'
import { summarizeFactoryCheck } from './factory-run-report'
import type { FactoryScriptRunner } from './factory-verify'

/**
 * Sets a run up for the factory: captures repo policy, creates `factory/<run>` from the base with
 * dependencies installed, and runs verify on it. A red baseline means parallel tasks cannot pass
 * the gate on their own, so planning then requires one root task that turns it green.
 */
export async function runFactoryBaseline(
  db: OrchestrationDb,
  host: FactoryIntegrationHost,
  params: { runId: string; worktreeSelector: string; baseBranch?: string },
  deps: { runner?: FactoryScriptRunner; git?: FactoryGitRunner } = {}
): Promise<FactoryBaselineResult> {
  const git = deps.git ?? runLocalGit
  db.requireRun(params.runId)
  if (db.listFactoryLandings(params.runId).length > 0) {
    throw new OrchestrationError(
      'factory_baseline_after_land',
      'This run already landed work, so a baseline would no longer describe the base branch.'
    )
  }
  const target = await host.resolveFactoryWorktreeTarget(params.worktreeSelector)
  if (target.executionHostId !== LOCAL_EXECUTION_HOST_ID || !target.repo) {
    throw new OrchestrationError(
      'factory_land_unsupported_host',
      'The factory runs on local and WSL repos only; this worktree is remote.'
    )
  }
  const repo = target.repo
  const existing = db.getFactoryRun(params.runId)
  if (existing && existing.repo_id !== repo.id) {
    throw new OrchestrationError(
      'factory_land_multi_repo',
      'This run is already a factory run for another repo; factory runs handle one repo each.'
    )
  }
  const settings = resolveFactoryRepoSettings(db, repo)
  const run = db.upsertFactoryRun({
    runId: params.runId,
    repoId: repo.id,
    baseBranch: params.baseBranch ?? null,
    maxWorkers: settings.maxWorkers,
    maxFixRounds: settings.maxFixRounds
  })
  const ensured = await ensureFactoryIntegration(
    db,
    host,
    {
      runId: params.runId,
      repo,
      baseBranch: run.base_branch ?? undefined,
      wslDistro: target.wslDistro
    },
    { runner: deps.runner, git, setupOnCreate: true }
  )
  const cwd = ensured.integration.worktree_path
  const setup = ensured.setup ?? (await runFactorySetup(repo, cwd, target.wslDistro, deps.runner))
  const check = await runFactoryCheck(db, {
    runId: params.runId,
    kind: 'baseline',
    repo,
    cwd,
    wslDistro: target.wslDistro,
    runner: deps.runner,
    git
  })
  return {
    runId: params.runId,
    integrationBranch: ensured.integration.integration_branch,
    integrationWorktreePath: cwd,
    setup,
    check: check ? summarizeFactoryCheck(check) : null
  }
}
