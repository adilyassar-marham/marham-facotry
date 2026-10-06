import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../db'
import { reattachDispatchConsumer } from '../db/root-dispatch-test-fixture'
import type { Repo } from '../../../../shared/repo-types'
import { enableFactoryGate, describeFactoryGate } from './factory-gate-approval'
import {
  runFactoryVerify,
  type FactoryScriptRunner,
  type FactoryVerifyHost
} from './factory-verify'
import { enforceFactoryGateBeforeWorkerSuccess } from './factory-worker-done-gate'
import type { FactoryGitRunner } from './factory-git'

let db: OrchestrationDb
let repoDir: string
let repo: Repo

function writeVerify(command: string): void {
  writeFileSync(join(repoDir, 'orca.yaml'), `scripts:\n  verify: ${command}\n`)
}

function startWorker(): { taskId: string; dispatchId: string } {
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
    worktreeId: `${repo.id}::/work/wt-a`
  })
  return { taskId: task.id, dispatchId: started.dispatch.id }
}

const host: FactoryVerifyHost = {
  resolveFactoryWorktreeTarget: async () => ({
    worktree: { path: '/work/wt-a', branch: 'feature-a' },
    repo,
    executionHostId: 'local'
  })
}

const cleanGit: FactoryGitRunner = async () => ({ ok: true, stdout: '', stderr: '' })

const passing: FactoryScriptRunner = async () => ({
  success: true,
  output: 'all green',
  exitCode: 0
})
const failing: FactoryScriptRunner = async () => ({
  success: false,
  output: 'FAIL src/a.test.ts\nCommand failed with exit code 1.',
  exitCode: 1
})

describe('factory verify', () => {
  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    repoDir = mkdtempSync(join(tmpdir(), 'orca-factory-'))
    repo = { id: 'repo_f', path: repoDir, displayName: 'app', badgeColor: '', addedAt: 0 }
    writeVerify('pnpm test')
    enableFactoryGate(db, repo, { expectedCommand: 'pnpm test' })
  })
  afterEach(() => {
    db.close()
    rmSync(repoDir, { recursive: true, force: true })
  })

  it('runs the approved command in the worker worktree and opens a ticket on pass', async () => {
    const { taskId } = startWorker()
    const runner = vi.fn(passing)
    const outcome = await runFactoryVerify(db, host, { taskId }, runner, cleanGit)
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ script: 'pnpm test', cwd: '/work/wt-a', timeoutMs: 600_000 })
    )
    expect(outcome).toMatchObject({ gated: true, result: { status: 'passed', ticket: 'open' } })
  })

  it('fails closed when orca.yaml verify changed after approval', async () => {
    const { taskId } = startWorker()
    writeVerify('true')
    const runner = vi.fn(passing)
    const outcome = await runFactoryVerify(db, host, { taskId }, runner, cleanGit)
    expect(runner).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ result: { status: 'not_approved', ticket: 'none' } })
    expect(describeFactoryGate(db, repo).stale).toBe(true)
  })

  it('treats a run with no observed exit as an error, never a pass', async () => {
    const { taskId } = startWorker()
    const timedOut: FactoryScriptRunner = async () => ({
      success: false,
      output: 'Hook timed out after 600000ms.'
    })
    const outcome = await runFactoryVerify(db, host, { taskId }, timedOut, cleanGit)
    expect(outcome).toMatchObject({ result: { status: 'error', timed_out: 1, ticket: 'none' } })
  })

  it('refuses remote worktrees instead of guessing', async () => {
    const { taskId } = startWorker()
    const remoteHost: FactoryVerifyHost = {
      resolveFactoryWorktreeTarget: async () => ({
        worktree: { path: '/srv/wt' },
        repo,
        executionHostId: 'ssh:box'
      })
    }
    const outcome = await runFactoryVerify(db, remoteHost, { taskId }, passing, cleanGit)
    expect(outcome).toMatchObject({ result: { status: 'error' } })
  })

  it('joins one in-flight verify instead of running the suite twice', async () => {
    const { taskId } = startWorker()
    const runner = vi.fn(passing)
    const [first, second] = await Promise.all([
      runFactoryVerify(db, host, { taskId }, runner, cleanGit),
      runFactoryVerify(db, host, { taskId }, runner, cleanGit)
    ])
    expect(runner).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })

  it('refuses a worker success with the failing output, then settles after a fix', async () => {
    const { taskId, dispatchId } = startWorker()
    await expect(
      enforceFactoryGateBeforeWorkerSuccess(
        db,
        host,
        { dispatchId, outcome: 'succeeded' },
        failing,
        cleanGit
      )
    ).rejects.toMatchObject({
      code: 'factory_verify_failed',
      message: expect.stringContaining('FAIL src/a.test.ts')
    })
    expect(db.getTask(taskId)?.status).not.toBe('completed')

    await enforceFactoryGateBeforeWorkerSuccess(
      db,
      host,
      { dispatchId, outcome: 'succeeded' },
      passing,
      cleanGit
    )
    expect(
      db.settleWorkerReport({ taskId, dispatchId, outcome: 'succeeded', result: 'done' })
    ).toMatchObject({ action: 'settled' })
    expect(db.getTask(taskId)?.status).toBe('completed')
  })

  it('does not run verify for a failure report', async () => {
    const { dispatchId } = startWorker()
    const runner = vi.fn(passing)
    await enforceFactoryGateBeforeWorkerSuccess(
      db,
      host,
      { dispatchId, outcome: 'failed' },
      runner,
      cleanGit
    )
    expect(runner).not.toHaveBeenCalled()
  })

  it('refuses uncommitted work before running verify, naming the files', async () => {
    const { taskId, dispatchId } = startWorker()
    const runner = vi.fn(passing)
    const dirtyGit: FactoryGitRunner = async () => ({
      ok: true,
      stdout: ' M src/spinner.tsx\n?? src/new-file.ts\n?? .orca/plan.json\n',
      stderr: ''
    })
    await expect(
      enforceFactoryGateBeforeWorkerSuccess(
        db,
        host,
        { dispatchId, outcome: 'succeeded' },
        runner,
        dirtyGit
      )
    ).rejects.toMatchObject({
      code: 'factory_verify_failed',
      message: expect.stringContaining('src/new-file.ts')
    })
    expect(runner).not.toHaveBeenCalled()
    const latest = db.listLatestFactoryVerifyResults([taskId]).get(taskId)
    expect(latest).toMatchObject({ status: 'failed', ticket: 'none', exit_code: null })
    expect(latest?.output_tail).not.toContain('.orca/plan.json')
  })

  it('refuses to approve a command the person did not see', () => {
    writeVerify('pnpm test && pnpm lint')
    expect(() => enableFactoryGate(db, repo, { expectedCommand: 'pnpm test' })).toThrow(
      /changed while you were reviewing/
    )
  })
})
