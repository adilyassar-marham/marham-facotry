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
import { isManagedGate, snapshotFactoryRunConfig } from './factory-managed-config'
import { snapshotFactoryRunSkills } from './factory-skill-snapshot'
import { resolveFactoryRepoSettings } from './factory-repo-settings'
import { summarizeFactoryCheck } from './factory-run-report'
import type { FactoryScriptRunner } from './factory-verify'

function linkRequest(db: OrchestrationDb, requestId: string, runId: string, repoId: string): void {
  const request = db.getFactoryRequest(requestId)
  if (!request || request.repo_id !== repoId) {
    throw new OrchestrationError(
      'factory_request_not_found',
      `Request ${requestId} does not exist for this repo; copy the id from your first message.`
    )
  }
  if (request.run_id !== runId && !db.linkFactoryRequestRun(requestId, runId)) {
    throw new OrchestrationError(
      'factory_request_already_linked',
      `Request ${requestId} already belongs to run ${request.run_id}; keep using that run.`
    )
  }
}

/**
 * Sets a run up for the factory: captures repo policy, creates `factory/<run>` from the base with
 * dependencies installed, and runs verify on it. A red baseline means parallel tasks cannot pass
 * the gate on their own, so planning then requires one root task that turns it green.
 */
export async function runFactoryBaseline(
  db: OrchestrationDb,
  host: FactoryIntegrationHost,
  params: { runId: string; worktreeSelector: string; baseBranch?: string; requestId?: string },
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
  if (params.requestId) {
    linkRequest(db, params.requestId, params.runId, repo.id)
  }
  const settings = resolveFactoryRepoSettings(db, repo)
  // A request pins its base commit at creation. Later commits on that branch do not change this run.
  const pin = params.requestId ? db.getFactoryRequestBase(params.requestId) : undefined
  const pinned = pin ? { commit: pin.base_commit, baseRef: pin.base_ref } : undefined
  const managed = isManagedGate(db.getFactoryGateApproval(repo.id))
    ? await snapshotFactoryRunConfig(db, { runId: params.runId, repo, pinned }, git)
    : null
  const skillCommit = pinned?.commit ?? managed?.base_commit
  if (skillCommit) {
    await snapshotFactoryRunSkills(db, { runId: params.runId, repo, commit: skillCommit }, git)
  }
  const run = db.upsertFactoryRun({
    runId: params.runId,
    repoId: repo.id,
    baseBranch: params.baseBranch ?? managed?.base_ref ?? null,
    maxWorkers: managed?.max_workers ?? settings.maxWorkers,
    maxFixRounds: managed?.max_fix_rounds ?? settings.maxFixRounds
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
  const setup =
    ensured.setup ??
    (await runFactorySetup(
      db,
      { runId: params.runId, repo, cwd, wslDistro: target.wslDistro },
      deps.runner
    ))
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
