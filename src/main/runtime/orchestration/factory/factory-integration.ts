import type { Repo } from '../../../../shared/repo-types'
import type { FactoryCheckKind } from '../../../../shared/factory-run-types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import type { FactoryCheckRow, FactoryIntegrationRow } from '../db/factory/factory-row-types'
import { readHeadSha, type FactoryGitRunner } from './factory-git'
import { resolveFactorySetupScript, resolveFactoryVerifyCommand } from './factory-managed-config'
import { tailFactoryVerifyOutput } from './factory-verify-command'
import {
  runApprovedScript,
  type FactoryScriptRunner,
  type FactoryVerifyHost
} from './factory-verify'

const SETUP_TIMEOUT_MS = 20 * 60 * 1000

export type FactoryIntegrationHost = FactoryVerifyHost & {
  createFactoryIntegrationWorktree(args: {
    repoId: string
    branch: string
    name: string
    baseBranch?: string
  }): Promise<{ id: string; path: string }>
}

export type FactorySetupOutcome = { ran: boolean; ok: boolean; outputTail: string }

/**
 * The repo's setup script (e.g. `npm install`): the run's committed rules when it has them,
 * otherwise the primary checkout's. Without it the integration worktree has no dependencies.
 */
export async function runFactorySetup(
  db: OrchestrationDb,
  params: { runId: string; repo: Repo; cwd: string; wslDistro?: string },
  runner: FactoryScriptRunner = runApprovedScript
): Promise<FactorySetupOutcome> {
  const script = resolveFactorySetupScript(db, params.repo, params.runId)
  if (!script) {
    return { ran: false, ok: true, outputTail: '' }
  }
  const run = await runner({
    script,
    cwd: params.cwd,
    repo: params.repo,
    wslDistro: params.wslDistro,
    timeoutMs: SETUP_TIMEOUT_MS
  }).catch((error: unknown) => ({
    success: false,
    output: error instanceof Error ? error.message : String(error)
  }))
  return { ran: true, ok: run.success, outputTail: tailFactoryVerifyOutput(run.output) }
}

export async function ensureFactoryIntegration(
  db: OrchestrationDb,
  host: FactoryIntegrationHost,
  params: { runId: string; repo: Repo; baseBranch?: string; wslDistro?: string },
  deps: { runner?: FactoryScriptRunner; git: FactoryGitRunner; setupOnCreate: boolean }
): Promise<{ integration: FactoryIntegrationRow; setup: FactorySetupOutcome | null }> {
  const existing = db.getFactoryIntegration(params.runId)
  if (existing) {
    if (existing.repo_id !== params.repo.id) {
      throw new OrchestrationError(
        'factory_land_multi_repo',
        'This run already lands into another repo; factory runs handle one repo each.'
      )
    }
    return { integration: existing, setup: null }
  }
  const branch = `factory/${params.runId}`
  const created = await host.createFactoryIntegrationWorktree({
    repoId: params.repo.id,
    branch,
    name: `factory-${params.runId}`,
    baseBranch: params.baseBranch
  })
  db.recordFactoryIntegration({
    runId: params.runId,
    repoId: params.repo.id,
    worktreeId: created.id,
    worktreePath: created.path,
    integrationBranch: branch
  })
  // Why: reviews and the PR diff are measured from the commit the run forked from.
  const baseSha = await readHeadSha(deps.git, created.path, params.wslDistro)
  if (baseSha) {
    db.setFactoryRunBaseSha(params.runId, baseSha)
  }
  const setup = deps.setupOnCreate
    ? await runFactorySetup(
        db,
        { runId: params.runId, repo: params.repo, cwd: created.path, wslDistro: params.wslDistro },
        deps.runner
      )
    : null
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: recorded just above.
  return { integration: db.getFactoryIntegration(params.runId) as FactoryIntegrationRow, setup }
}

/** Verify on the whole integration branch, pinned to its commit so a later land makes it stale. */
export async function runFactoryCheck(
  db: OrchestrationDb,
  params: {
    runId: string
    kind: FactoryCheckKind
    repo: Repo
    cwd: string
    wslDistro?: string
    runner?: FactoryScriptRunner
    git: FactoryGitRunner
  }
): Promise<FactoryCheckRow | null> {
  const approval = db.getFactoryGateApproval(params.repo.id)
  if (!approval) {
    return null
  }
  const headSha = (await readHeadSha(params.git, params.cwd, params.wslDistro)) ?? 'unknown'
  const startedAt = Date.now()
  const record = (
    status: FactoryCheckRow['status'],
    exitCode: number | null,
    output: string
  ): FactoryCheckRow =>
    db.recordFactoryCheck({
      run_id: params.runId,
      kind: params.kind,
      head_sha: headSha,
      status,
      exit_code: exitCode,
      timed_out: /timed out after/i.test(output),
      duration_ms: Date.now() - startedAt,
      output_tail: tailFactoryVerifyOutput(output)
    })
  const resolved = resolveFactoryVerifyCommand(db, {
    repo: params.repo,
    approval,
    runId: params.runId
  })
  if (!resolved.ok) {
    return record('not_approved', null, resolved.why)
  }
  const run = await (params.runner ?? runApprovedScript)({
    script: resolved.command,
    cwd: params.cwd,
    repo: params.repo,
    wslDistro: params.wslDistro,
    timeoutMs: approval.timeout_seconds * 1000
  }).catch((error: unknown) => ({
    success: false,
    output: error instanceof Error ? error.message : String(error),
    exitCode: undefined
  }))
  const status = run.success ? 'passed' : run.exitCode === undefined ? 'error' : 'failed'
  return record(status, run.exitCode ?? null, run.output)
}
