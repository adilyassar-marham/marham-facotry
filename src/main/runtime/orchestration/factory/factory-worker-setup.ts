import type { Repo } from '../../../../shared/repo-types'
import type { OrchestrationDb } from '../db'
import { resolveFactorySetupScript } from './factory-managed-config'
import type { FactoryScriptRunner, FactoryVerifyHost } from './factory-verify'

const SETUP_TIMEOUT_MS = 20 * 60 * 1000

export type FactoryDependencyOutcome = { ok: true; changed: boolean } | { ok: false; why: string }

function stringField(value: object, key: string): string | undefined {
  const raw = Object.getOwnPropertyDescriptor(value, key)?.value
  return typeof raw === 'string' && raw ? raw : undefined
}

/** The setup terminal recorded on the worker, if this start actually launched one. */
export function readWorkerSetupTerminalId(effectsJson: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(effectsJson)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) {
    return undefined
  }
  let fromSetup: string | undefined
  let fromTerminal: string | undefined
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const kind = stringField(entry, 'kind')
    if (kind === 'setup') {
      fromSetup = stringField(entry, 'terminalId')
    }
    if (kind === 'terminal' && stringField(entry, 'role') === 'setup') {
      fromTerminal = stringField(entry, 'id')
    }
  }
  return fromSetup ?? fromTerminal
}

async function runMissingSetup(
  db: OrchestrationDb,
  params: {
    runId: string
    repo: Repo
    cwd: string
    wslDistro?: string
    runner: FactoryScriptRunner
  }
): Promise<FactoryDependencyOutcome> {
  const script = resolveFactorySetupScript(db, params.repo, params.runId)
  if (!script) {
    return { ok: true, changed: false }
  }
  const setup = await params
    .runner({
      script,
      cwd: params.cwd,
      repo: params.repo,
      wslDistro: params.wslDistro,
      timeoutMs: SETUP_TIMEOUT_MS
    })
    .catch((error: unknown) => ({
      success: false,
      output: error instanceof Error ? error.message : String(error)
    }))
  if (!setup.success) {
    return {
      ok: false,
      why: [
        'The project setup (for example npm install) failed, so the quality check cannot run.',
        setup.output
      ].join('\n')
    }
  }
  return { ok: true, changed: true }
}

/**
 * Verify assumes dependencies exist. A worker started with `--setup run` still has none when
 * `orca.yaml` was only on the primary checkout, and a start-immediately install may still be
 * running when the agent reports done.
 */
export async function ensureFactoryWorkerDependencies(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  params: {
    dispatchId?: string
    runId: string
    repo: Repo
    cwd: string
    wslDistro?: string
    runner: FactoryScriptRunner
  }
): Promise<FactoryDependencyOutcome> {
  const worker = params.dispatchId ? db.getWorkerDispatch(params.dispatchId) : undefined
  if (!worker) {
    return { ok: true, changed: false }
  }
  if (worker.setup_state === 'running') {
    const terminalId = readWorkerSetupTerminalId(worker.effects)
    if (!terminalId || !host.waitForSetupTerminalCompletion) {
      return {
        ok: false,
        why:
          'Project setup is still installing dependencies. Wait until it finishes, then send ' +
          'worker_done again.'
      }
    }
    try {
      const completion = await host.waitForSetupTerminalCompletion(terminalId)
      if (completion.exitCode !== 0) {
        const exitCode = completion.exitCode ?? 'unknown'
        return {
          ok: false,
          why: `Project setup failed (exit ${exitCode}). Fix that before this task can pass.`
        }
      }
      return { ok: true, changed: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('terminal_handle_stale')) {
        return { ok: false, why: `Could not wait for project setup: ${message}` }
      }
      return runMissingSetup(db, params)
    }
  }
  if (worker.setup_state === 'failed' || worker.setup_state === 'spawn_failed') {
    return {
      ok: false,
      why: 'Project setup failed before the quality check. Fix the setup script, then try again.'
    }
  }
  if (worker.setup_state !== 'not_configured') {
    return { ok: true, changed: false }
  }
  if (!resolveFactorySetupScript(db, params.repo, params.runId)) {
    return { ok: true, changed: false }
  }
  return runMissingSetup(db, params)
}
