import { runHookScript } from '../../../hooks'
import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import type { OrchestrationDb } from '../db'
import type {
  FactoryGateApprovalRow,
  FactoryVerifyResultRow,
  FactoryVerifyStatus
} from '../db/factory/factory-row-types'
import { listUncommittedChanges, runLocalGit, type FactoryGitRunner } from './factory-git'
import { ensureShippedFactoryGate } from './factory-gate-approval'
import { resolveFactoryVerifyCommand } from './factory-managed-config'
import { tailFactoryVerifyOutput } from './factory-verify-command'
import { ensureFactoryWorkerDependencies } from './factory-worker-setup'

export type FactoryWorktreeTarget = {
  worktree: { path: string; branch?: string | null }
  repo?: Repo
  executionHostId: ExecutionHostId
  wslDistro?: string
}

export type FactoryVerifyHost = {
  resolveFactoryWorktreeTarget(worktreeSelector: string): Promise<FactoryWorktreeTarget>
  /** Present on the real runtime. The gate waits on a setup terminal that is still installing. */
  waitForSetupTerminalCompletion?(
    handle: string,
    signal?: AbortSignal
  ): Promise<{ exitCode: number | null }>
}

export type FactoryScriptRun = { success: boolean; output: string; exitCode?: number }

export type FactoryScriptRunner = (args: {
  script: string
  cwd: string
  repo: Repo
  wslDistro?: string
  timeoutMs: number
}) => Promise<FactoryScriptRun>

export type FactoryVerifyOutcome =
  | { gated: false }
  | { gated: true; command: string | undefined; result: FactoryVerifyResultRow }

export const runApprovedScript: FactoryScriptRunner = (args) =>
  runHookScript(
    'verify',
    args.script,
    args.cwd,
    args.repo,
    args.wslDistro ? { wslDistro: args.wslDistro } : undefined,
    args.timeoutMs
  )

type Prepared =
  | { kind: 'refused'; status: Extract<FactoryVerifyStatus, 'not_approved' | 'error'>; why: string }
  | { kind: 'run'; command: string; cwd: string; repo: Repo; wslDistro?: string }

async function prepare(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  gate: { taskId: string; worktreeId: string; approval: FactoryGateApprovalRow }
): Promise<Prepared> {
  let target: FactoryWorktreeTarget
  try {
    target = await host.resolveFactoryWorktreeTarget(`id:${gate.worktreeId}`)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return {
      kind: 'refused',
      status: 'error',
      why: `Worktree ${gate.worktreeId} not resolvable: ${why}`
    }
  }
  if (target.executionHostId !== LOCAL_EXECUTION_HOST_ID || !target.repo) {
    return {
      kind: 'refused',
      status: 'error',
      why: 'The factory gate runs verify on local and WSL repos only; this worktree is remote.'
    }
  }
  const resolved = resolveFactoryVerifyCommand(db, {
    repo: target.repo,
    approval: gate.approval,
    runId: db.getTask(gate.taskId)?.run_id
  })
  if (!resolved.ok) {
    return { kind: 'refused', status: 'not_approved', why: resolved.why }
  }
  return {
    kind: 'run',
    command: resolved.command,
    cwd: target.worktree.path,
    repo: target.repo,
    wslDistro: target.wslDistro
  }
}

/** Land merges commits, so work left only in the working tree would pass verify and then vanish. */
async function describeUncommittedWork(
  git: FactoryGitRunner,
  cwd: string,
  wslDistro?: string
): Promise<string | null> {
  const changes = await listUncommittedChanges(git, cwd, wslDistro)
  if (changes === null) {
    return 'Could not read git status in this worktree, so Orca cannot tell what would land.'
  }
  if (changes.length === 0) {
    return null
  }
  return [
    'Uncommitted changes in this worktree. Land merges commits only, so this work would be lost.',
    'Commit everything that belongs to the task (git add + git commit), discard the rest, then',
    'send worker_done again.',
    ...changes.slice(0, 40)
  ].join('\n')
}

async function armShippedGate(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  params: { taskId: string; dispatchId?: string }
): Promise<void> {
  const worktree = db.findFactoryTaskWorktree(params.taskId, params.dispatchId)
  if (!worktree) {
    return
  }
  try {
    const target = await host.resolveFactoryWorktreeTarget(`id:${worktree.worktree_id}`)
    if (target.repo) {
      ensureShippedFactoryGate(db, target.repo)
    }
  } catch {
    // A worktree that cannot be resolved is reported when verify looks it up again.
  }
}

async function verifyOnce(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  params: { taskId: string; dispatchId?: string },
  runner: FactoryScriptRunner,
  git: FactoryGitRunner
): Promise<FactoryVerifyOutcome> {
  await armShippedGate(db, host, params)
  const gate = db.resolveFactoryGateTarget(params.taskId, params.dispatchId)
  if (!gate) {
    return { gated: false }
  }
  const id = db.beginFactoryVerify({
    taskId: gate.taskId,
    dispatchId: gate.dispatchId,
    worktreeId: gate.worktreeId
  })
  const startedAt = Date.now()
  const prepared = await prepare(db, host, gate)
  if (prepared.kind === 'refused') {
    const result = db.finishFactoryVerify({
      id,
      status: prepared.status,
      exitCode: null,
      timedOut: false,
      durationMs: Date.now() - startedAt,
      outputTail: prepared.why
    })
    return { gated: true, command: undefined, result }
  }
  const refuse = (
    status: Exclude<FactoryVerifyStatus, 'running'>,
    exitCode: number | null,
    outputTail: string
  ): FactoryVerifyOutcome => {
    const result = db.finishFactoryVerify({
      id,
      status,
      exitCode,
      timedOut: false,
      durationMs: Date.now() - startedAt,
      outputTail
    })
    return { gated: true, command: prepared.command, result }
  }
  const uncommitted = await describeUncommittedWork(git, prepared.cwd, prepared.wslDistro)
  if (uncommitted) {
    return refuse('failed', null, uncommitted)
  }
  const task = db.getTask(gate.taskId)
  const dependencies = await ensureFactoryWorkerDependencies(db, host, {
    dispatchId: params.dispatchId,
    runId: task?.run_id ?? '',
    repo: prepared.repo,
    cwd: prepared.cwd,
    wslDistro: prepared.wslDistro,
    runner
  })
  if (!dependencies.ok) {
    return refuse('failed', 1, dependencies.why)
  }
  if (dependencies.changed) {
    const dirtyAfterSetup = await describeUncommittedWork(git, prepared.cwd, prepared.wslDistro)
    if (dirtyAfterSetup) {
      return refuse('failed', null, dirtyAfterSetup)
    }
  }
  const run = await runner({
    script: prepared.command,
    cwd: prepared.cwd,
    repo: prepared.repo,
    wslDistro: prepared.wslDistro,
    timeoutMs: gate.approval.timeout_seconds * 1000
  }).catch((error: unknown): FactoryScriptRun => ({
    success: false,
    output: error instanceof Error ? error.message : String(error)
  }))
  // Why: no observed exit (timeout, signal, spawn failure) is never a pass, whatever was printed.
  const status: FactoryVerifyStatus = run.success
    ? 'passed'
    : run.exitCode === undefined
      ? 'error'
      : 'failed'
  const result = db.finishFactoryVerify({
    id,
    status,
    exitCode: run.exitCode ?? null,
    timedOut: /timed out after/i.test(run.output),
    durationMs: Date.now() - startedAt,
    outputTail: tailFactoryVerifyOutput(run.output)
  })
  return { gated: true, command: prepared.command, result }
}

const inFlight = new WeakMap<OrchestrationDb, Map<string, Promise<FactoryVerifyOutcome>>>()

/** One verify per Task at a time: a retried `worker_done` joins the run already in progress. */
export function runFactoryVerify(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  params: { taskId: string; dispatchId?: string },
  runner: FactoryScriptRunner = runApprovedScript,
  git: FactoryGitRunner = runLocalGit
): Promise<FactoryVerifyOutcome> {
  let perDb = inFlight.get(db)
  if (!perDb) {
    perDb = new Map()
    inFlight.set(db, perDb)
  }
  const existing = perDb.get(params.taskId)
  if (existing) {
    return existing
  }
  const running = verifyOnce(db, host, params, runner, git).finally(() => {
    perDb.delete(params.taskId)
  })
  perDb.set(params.taskId, running)
  return running
}
