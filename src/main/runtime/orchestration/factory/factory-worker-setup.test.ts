import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { OrchestrationDb } from '../db'
import { reattachDispatchConsumer } from '../db/root-dispatch-test-fixture'
import { enableFactoryGate } from './factory-gate-approval'
import {
  runFactoryVerify,
  type FactoryScriptRunner,
  type FactoryVerifyHost
} from './factory-verify'

let db: OrchestrationDb
let repoDir: string
let repo: Repo

function startWorker(
  setupState: string,
  effects?: unknown[]
): { taskId: string; dispatchId: string } {
  const task = db.createTask({ runId: 'run_legacy_local', spec: 'feature' })
  const started = db.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    taskId: task.id,
    startOptions: {}
  })
  reattachDispatchConsumer(db, {
    dispatchId: started.dispatch.id,
    paneKey: 'tab_worker:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    processIncarnation: 'runtime_test:term_worker:1'
  })
  db.recordWorkerStage({
    dispatchId: started.dispatch.id,
    stage: 'running',
    worktreeId: `${repo.id}::/work/wt-a`,
    setupState,
    ...(effects ? { effects } : {})
  })
  return { taskId: task.id, dispatchId: started.dispatch.id }
}

describe('factory worker setup before verify', () => {
  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    repoDir = mkdtempSync(join(tmpdir(), 'orca-factory-setup-'))
    repo = { id: 'repo_f', path: repoDir, displayName: 'app', badgeColor: '', addedAt: 0 }
    writeFileSync(
      join(repoDir, 'orca.yaml'),
      'scripts:\n  setup: npm install\n  verify: pnpm test\n'
    )
    enableFactoryGate(db, repo, { expectedCommand: 'pnpm test' })
  })
  afterEach(() => {
    db.close()
    rmSync(repoDir, { recursive: true, force: true })
  })

  const host: FactoryVerifyHost = {
    resolveFactoryWorktreeTarget: async () => ({
      worktree: { path: '/work/wt-a', branch: 'feature-a' },
      repo,
      executionHostId: 'local'
    })
  }
  const cleanGit = async () => ({ ok: true, stdout: '', stderr: '' })

  it('installs dependencies when the worker worktree never found orca.yaml', async () => {
    const { taskId, dispatchId } = startWorker('not_configured')
    const scripts: string[] = []
    const runner: FactoryScriptRunner = async (args) => {
      scripts.push(args.script)
      return { success: true, output: '', exitCode: 0 }
    }
    const outcome = await runFactoryVerify(db, host, { taskId, dispatchId }, runner, cleanGit)
    expect(scripts).toEqual(['npm install', 'pnpm test'])
    expect(outcome).toMatchObject({ result: { status: 'passed' } })
  })

  it('waits for an install that is still running, and does not start a second one', async () => {
    const { taskId, dispatchId } = startWorker('running', [
      { kind: 'setup', state: 'running', terminalId: 'term_setup' }
    ])
    const wait = vi.fn(async () => ({ exitCode: 0 }))
    const waitingHost: FactoryVerifyHost = { ...host, waitForSetupTerminalCompletion: wait }
    const runner = vi.fn(async (_args: Parameters<FactoryScriptRunner>[0]) => ({
      success: true,
      output: '',
      exitCode: 0
    }))
    const outcome = await runFactoryVerify(
      db,
      waitingHost,
      { taskId, dispatchId },
      runner,
      cleanGit
    )
    expect(wait).toHaveBeenCalledWith('term_setup')
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner.mock.calls[0]?.[0]).toMatchObject({ script: 'pnpm test' })
    expect(outcome).toMatchObject({ result: { status: 'passed' } })
  })

  it('refuses the task when that install fails', async () => {
    const { taskId, dispatchId } = startWorker('running', [
      { kind: 'setup', state: 'running', terminalId: 'term_setup' }
    ])
    const waitingHost: FactoryVerifyHost = {
      ...host,
      waitForSetupTerminalCompletion: async () => ({ exitCode: 1 })
    }
    const runner = vi.fn(async () => ({ success: true, output: '', exitCode: 0 }))
    const outcome = await runFactoryVerify(
      db,
      waitingHost,
      { taskId, dispatchId },
      runner,
      cleanGit
    )
    expect(runner).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ result: { status: 'failed', exit_code: 1 } })
  })
})
