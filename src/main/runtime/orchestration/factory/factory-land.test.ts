import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../db'
import { reattachDispatchConsumer } from '../db/root-dispatch-test-fixture'
import type { Repo } from '../../../../shared/repo-types'
import { applyFactoryPlan } from './factory-plan'
import { landFactoryRun, type FactoryLandHost } from './factory-land'
import { hashFactoryVerifyCommand } from './factory-verify-command'
import type { FactoryScriptRunner } from './factory-verify'

const RUN = 'run_legacy_local'
let db: OrchestrationDb
let root: string
let repo: Repo
let baseSha: string
const branches = new Map<string, { path: string; branch: string }>()

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function commitOnBranch(branch: string, file: string, content: string): string {
  const path = join(root, `wt-${branch}`)
  git(repo.path, 'worktree', 'add', '-q', '-b', branch, path, 'main')
  writeFileSync(join(path, file), content)
  git(path, 'add', '.')
  git(path, 'commit', '-qm', `work on ${branch}`)
  const worktreeId = `${repo.id}::${path}`
  branches.set(worktreeId, { path, branch })
  return worktreeId
}

function completeTask(taskId: string, worktreeId: string): void {
  const started = db.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    taskId,
    startOptions: {}
  })
  reattachDispatchConsumer(db, {
    dispatchId: started.dispatch.id,
    paneKey: 'tab_worker:dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    processIncarnation: `runtime_test:${taskId}:1`
  })
  db.recordWorkerStage({ dispatchId: started.dispatch.id, stage: 'running', worktreeId })
  expect(
    db.settleWorkerReport({
      taskId,
      dispatchId: started.dispatch.id,
      outcome: 'succeeded',
      result: 'ok'
    })
  ).toMatchObject({ action: 'settled' })
}

const host: FactoryLandHost = {
  resolveFactoryWorktreeTarget: async (selector) => {
    const entry = branches.get(selector.slice('id:'.length))
    if (!entry) {
      throw new Error(`unknown worktree ${selector}`)
    }
    return { worktree: entry, repo, executionHostId: 'local' }
  },
  createFactoryIntegrationWorktree: async ({ branch, baseBranch }) => {
    const path = join(root, 'integration')
    git(repo.path, 'worktree', 'add', '-q', '-b', branch, path, baseBranch ?? 'main')
    return { id: `${repo.id}::${path}`, path }
  }
}

describe('factory land (real git)', () => {
  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    root = mkdtempSync(join(tmpdir(), 'orca-factory-land-'))
    const path = join(root, 'repo')
    execFileSync('git', ['init', '-q', '-b', 'main', path])
    git(path, 'config', 'user.email', 'factory@test.local')
    git(path, 'config', 'user.name', 'Factory Test')
    writeFileSync(join(path, 'shared.txt'), 'line one\n')
    git(path, 'add', '.')
    git(path, 'commit', '-qm', 'base')
    baseSha = git(path, 'rev-parse', 'HEAD')
    repo = { id: 'repo_land', path, displayName: 'app', badgeColor: '', addedAt: 0 }
    branches.clear()
  })
  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('merges completed tasks in dependency order, then reports them as already landed', async () => {
    const tasks = applyFactoryPlan(db, {
      runId: RUN,
      tasks: [
        { key: 'ui', title: 'UI', spec: 'screen', deps: ['api'] },
        { key: 'api', title: 'API', spec: 'endpoint' }
      ]
    })
    const id = Object.fromEntries(tasks.map((task) => [task.key, task.taskId]))
    completeTask(id.api, commitOnBranch('feat-api', 'api.txt', 'api\n'))
    completeTask(id.ui, commitOnBranch('feat-ui', 'ui.txt', 'ui\n'))

    const first = await landFactoryRun(db, host, { runId: RUN })
    expect(first.steps.map((step) => [step.taskId, step.outcome])).toEqual([
      [id.api, 'merged'],
      [id.ui, 'merged']
    ])
    expect(existsSync(join(first.integrationWorktreePath, 'ui.txt'))).toBe(true)
    // Landing must never move the base branch; shipping stays a human review decision.
    expect(git(repo.path, 'rev-parse', 'main')).toBe(baseSha)

    const second = await landFactoryRun(db, host, { runId: RUN })
    expect(second.steps.every((step) => step.outcome === 'already_landed')).toBe(true)
  })

  it('stops on a conflict, aborts the merge, and leaves the integration branch clean', async () => {
    const tasks = applyFactoryPlan(db, {
      runId: RUN,
      tasks: [
        { key: 'one', spec: 'edit shared' },
        { key: 'two', spec: 'edit shared differently' }
      ]
    })
    const id = Object.fromEntries(tasks.map((task) => [task.key, task.taskId]))
    completeTask(id.one, commitOnBranch('feat-one', 'shared.txt', 'line from one\n'))
    completeTask(id.two, commitOnBranch('feat-two', 'shared.txt', 'line from two\n'))

    const result = await landFactoryRun(db, host, { runId: RUN })
    expect(result.stoppedOnConflict).toBe(true)
    expect(result.steps).toEqual([
      expect.objectContaining({ taskId: id.one, outcome: 'merged' }),
      { taskId: id.two, outcome: 'conflict', files: ['shared.txt'] }
    ])
    expect(git(result.integrationWorktreePath, 'status', '--porcelain')).toBe('')
    expect(db.listFactoryLandings(RUN).map((landing) => landing.task_id)).toEqual([id.one])
  })

  it('holds a gated task without a passing verify, and its dependents with it', async () => {
    const tasks = applyFactoryPlan(db, {
      runId: RUN,
      tasks: [
        { key: 'base', spec: 'base' },
        { key: 'next', spec: 'next', deps: ['base'] }
      ]
    })
    const id = Object.fromEntries(tasks.map((task) => [task.key, task.taskId]))
    // Completed while the gate was off, so no verify exists for it.
    completeTask(id.base, commitOnBranch('feat-base', 'base.txt', 'b\n'))
    db.approveFactoryGate({
      repoId: repo.id,
      contentHash: 'h',
      command: 'true',
      timeoutSeconds: 60
    })

    const result = await landFactoryRun(db, host, { runId: RUN })
    expect(result.steps).toEqual([])
    expect(result.skipped).toEqual([
      { taskId: id.base, reason: 'completed without a passing verify on record' },
      { taskId: id.next, reason: `waits for ${id.base} to land first` }
    ])
  })

  it('skips a completed branch with no new commits instead of reporting it merged', async () => {
    const [task] = applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: 'edit' }] })
    const path = join(root, 'wt-empty')
    git(repo.path, 'worktree', 'add', '-q', '-b', 'feat-empty', path, 'main')
    // The worker edited files but never committed: land must not call that "merged".
    writeFileSync(join(path, 'shared.txt'), 'uncommitted\n')
    const worktreeId = `${repo.id}::${path}`
    branches.set(worktreeId, { path, branch: 'feat-empty' })
    completeTask(task.taskId, worktreeId)

    const result = await landFactoryRun(db, host, { runId: RUN })
    expect(result.steps).toEqual([])
    expect(result.skipped).toEqual([
      { taskId: task.taskId, reason: expect.stringContaining('no commits to land') }
    ])
    expect(db.listFactoryLandings(RUN)).toEqual([])
  })

  it('re-runs setup, then verifies the merged branch and pins the check to its commit', async () => {
    writeFileSync(
      join(repo.path, 'orca.yaml'),
      'scripts:\n  setup: npm install\n  verify: npx tsc --noEmit\n'
    )
    const [task] = applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: 'api' }] })
    completeTask(task.taskId, commitOnBranch('feat-a', 'a.txt', 'a\n'))
    db.approveFactoryGate({
      repoId: repo.id,
      contentHash: hashFactoryVerifyCommand('npx tsc --noEmit'),
      command: 'npx tsc --noEmit',
      timeoutSeconds: 60
    })
    const verifyId = db.beginFactoryVerify({
      taskId: task.taskId,
      dispatchId: null,
      worktreeId: 'x'
    })
    db.finishFactoryVerify({
      id: verifyId,
      status: 'passed',
      exitCode: 0,
      timedOut: false,
      durationMs: 1,
      outputTail: ''
    })
    const scripts: string[] = []
    const runner: FactoryScriptRunner = async ({ script }) => {
      scripts.push(script)
      return { success: true, output: 'ok', exitCode: 0 }
    }

    const result = await landFactoryRun(db, host, { runId: RUN }, { runner })
    expect(scripts).toEqual(['npm install', 'npx tsc --noEmit'])
    expect(result.integrationVerify).toMatchObject({ status: 'passed' })
    expect(db.getLatestFactoryCheck(RUN, 'integration')?.head_sha).toBe(
      git(result.integrationWorktreePath, 'rev-parse', 'HEAD')
    )
  })
})
