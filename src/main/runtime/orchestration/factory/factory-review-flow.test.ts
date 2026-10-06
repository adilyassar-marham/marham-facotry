import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { OrchestrationDb } from '../db'
import { runFactoryBaseline } from './factory-baseline'
import { cleanupFactoryRun } from './factory-cleanup'
import {
  approveGate,
  commitFile,
  createFactoryHost,
  createFactoryRepo,
  git,
  passingRunner,
  startFactoryWorker
} from './factory-flow-test-fixture'
import { landFactoryRun } from './factory-land'
import { applyFactoryPlan } from './factory-plan'
import { openFactoryPullRequest } from './factory-pr'
import { createFactoryFixTask, startFactoryReview } from './factory-review'
import { describeFactoryPrReadiness } from './factory-run-report'
import { runFactoryVerify } from './factory-verify'
import { enforceFactoryGateBeforeWorkerSuccess } from './factory-worker-done-gate'

const RUN = 'run_legacy_local'
let db: OrchestrationDb
let root: string
let repo: Repo
let remote: string
let host: ReturnType<typeof createFactoryHost>

/** Builds on its own branch from the integration branch, passes the gate, and completes. */
async function buildTask(taskId: string, file: string, content: string): Promise<void> {
  const worktreeId = host.addWorktree(`task-${taskId}`, `factory/${RUN}`)
  const target = await host.resolveFactoryWorktreeTarget(`id:${worktreeId}`)
  const dispatchId = startFactoryWorker(db, taskId, worktreeId)
  commitFile(target.worktree.path, file, content)
  await enforceFactoryGateBeforeWorkerSuccess(
    db,
    host,
    { dispatchId, outcome: 'succeeded' },
    passingRunner
  )
  expect(
    db.settleWorkerReport({ taskId, dispatchId, outcome: 'succeeded', result: 'done' })
  ).toMatchObject({ action: 'settled' })
}

/** A reviewer worker on the integration head that files `report` through worker_done. */
async function review(taskId: string, report: object): Promise<void> {
  const worktreeId = host.addWorktree(`review-${taskId}`, `factory/${RUN}`)
  const target = await host.resolveFactoryWorktreeTarget(`id:${worktreeId}`)
  const dispatchId = startFactoryWorker(db, taskId, worktreeId)
  mkdirSync(join(target.worktree.path, '.orca'), { recursive: true })
  writeFileSync(join(target.worktree.path, '.orca', 'factory-review.json'), JSON.stringify(report))
  await enforceFactoryGateBeforeWorkerSuccess(db, host, {
    dispatchId,
    outcome: 'succeeded',
    reportPath: '.orca/factory-review.json'
  })
  expect(
    db.settleWorkerReport({ taskId, dispatchId, outcome: 'succeeded', result: 'reviewed' })
  ).toMatchObject({ action: 'settled' })
}

describe('factory review loop to PR (real git)', () => {
  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    ;({ root, repo, remote } = createFactoryRepo())
    host = createFactoryHost(root, repo)
    approveGate(db, repo)
  })
  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('baseline → build → land → failed review → fix → passing review → clicked PR → cleanup', async () => {
    const baseline = await runFactoryBaseline(
      db,
      host,
      { runId: RUN, worktreeSelector: `id:${repo.id}::${repo.path}` },
      { runner: passingRunner }
    )
    expect(baseline).toMatchObject({
      integrationBranch: `factory/${RUN}`,
      setup: { ran: true, ok: true },
      check: { status: 'passed', kind: 'baseline' }
    })
    expect(db.getFactoryRun(RUN)?.base_sha).toBe(git(repo.path, 'rev-parse', 'main'))

    const [task] = applyFactoryPlan(db, {
      runId: RUN,
      tasks: [{ key: 'api', title: 'Add API', spec: 'add api.ts', acceptance: ['exports api'] }]
    })
    await buildTask(task.taskId, 'api.ts', 'export const api = 1\n')
    const landed = await landFactoryRun(db, host, { runId: RUN }, { runner: passingRunner })
    expect(landed.integrationVerify).toMatchObject({ status: 'passed' })

    const round1 = await startFactoryReview(db, host, { runId: RUN })
    expect(round1).toMatchObject({ kind: 'reviewer_needed', round: 1 })
    if (round1.kind !== 'reviewer_needed') {
      return
    }
    expect(round1.guidelines).toEqual([join(repo.path, '.cursor', 'rules', 'code.mdc')])
    expect(db.getTask(round1.reviewTaskId)?.spec).toContain('Add API')
    // Review tasks change no code: the build gate must not apply to them.
    expect(db.resolveFactoryGateTarget(round1.reviewTaskId)).toBeUndefined()
    await review(round1.reviewTaskId, {
      verdict: 'fail',
      summary: 'One rule broken.',
      findings: [{ rule: '1. Minimal code', file: 'api.ts', line: 1, problem: 'Unused export' }]
    })
    expect(describeFactoryPrReadiness(db, RUN).reasons.join(' ')).toContain('round 1 failed')

    const fix = await createFactoryFixTask(db, host, { runId: RUN })
    expect(db.getTask(fix.fixTaskId)?.spec).toContain('Unused export')
    await expect(createFactoryFixTask(db, host, { runId: RUN })).rejects.toMatchObject({
      code: 'factory_fix_exists'
    })
    await buildTask(fix.fixTaskId, 'api.ts', 'export const api = 2\n')
    await landFactoryRun(db, host, { runId: RUN }, { runner: passingRunner })

    const round2 = await startFactoryReview(db, host, { runId: RUN })
    expect(round2).toMatchObject({ kind: 'reviewer_needed', round: 2 })
    if (round2.kind !== 'reviewer_needed') {
      return
    }
    expect(db.getTask(round2.reviewTaskId)?.spec).toContain('confirm each is fixed')
    await review(round2.reviewTaskId, { verdict: 'pass', summary: 'Clean.', findings: [] })
    expect(describeFactoryPrReadiness(db, RUN)).toEqual({ ready: true, reasons: [] })

    const opened = await openFactoryPullRequest(
      db,
      repo,
      { runId: RUN },
      {
        createReview: async (args) => {
          expect(args.body).toContain('Guideline review round 2 passed')
          return { ok: true, number: 7, url: 'https://example.test/pr/7' }
        }
      }
    )
    expect(opened).toMatchObject({ ok: true, pullRequest: { number: 7, baseBranch: 'main' } })
    // Pushed to origin's fetch URL even though pushurl is DISABLED, and only the factory branch.
    expect(git(remote, 'rev-parse', `refs/heads/factory/${RUN}`)).toBe(
      git(landed.integrationWorktreePath, 'rev-parse', 'HEAD')
    )
    expect(git(remote, 'rev-parse', 'main')).toBe(db.getFactoryRun(RUN)?.base_sha)
    expect(describeFactoryPrReadiness(db, RUN).ready).toBe(false)

    const cleaned = await cleanupFactoryRun(db, host, { runId: RUN })
    expect(cleaned.removed).toHaveLength(4)
    expect(existsSync(landed.integrationWorktreePath)).toBe(true)
  })

  it('refuses the PR when the branch moved after review', async () => {
    await runFactoryBaseline(
      db,
      host,
      { runId: RUN, worktreeSelector: `id:${repo.id}::${repo.path}` },
      { runner: passingRunner }
    )
    const [task] = applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: 'a' }] })
    await buildTask(task.taskId, 'a.ts', 'export const a = 1\n')
    const landed = await landFactoryRun(db, host, { runId: RUN }, { runner: passingRunner })
    const round = await startFactoryReview(db, host, { runId: RUN })
    if (round.kind === 'reviewer_needed') {
      await review(round.reviewTaskId, { verdict: 'pass', summary: 'Clean.', findings: [] })
    }
    commitFile(landed.integrationWorktreePath, 'sneaky.ts', 'export const x = 1\n')
    const result = await openFactoryPullRequest(db, repo, { runId: RUN })
    expect(result).toMatchObject({
      ok: false,
      pushed: false,
      error: expect.stringContaining('moved')
    })
  })

  it('fails a round itself when the diff carries secrets, with no reviewer', async () => {
    await runFactoryBaseline(
      db,
      host,
      { runId: RUN, worktreeSelector: `id:${repo.id}::${repo.path}` },
      { runner: passingRunner }
    )
    const [task] = applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: 'a' }] })
    await buildTask(task.taskId, '.env', 'TOKEN=secret\n')
    await landFactoryRun(db, host, { runId: RUN }, { runner: passingRunner })
    const round = await startFactoryReview(db, host, { runId: RUN })
    expect(round).toMatchObject({
      kind: 'failed_mechanically',
      review: {
        verdict: 'fail',
        mechanical: true,
        findings: [expect.objectContaining({ file: '.env' })]
      }
    })
  })

  it('stops the loop for a person once the fix rounds are used up', async () => {
    await runFactoryBaseline(
      db,
      host,
      { runId: RUN, worktreeSelector: `id:${repo.id}::${repo.path}` },
      { runner: passingRunner }
    )
    db.db.prepare('UPDATE factory_runs SET max_fix_rounds = 0 WHERE run_id = ?').run(RUN)
    const [task] = applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: 'a' }] })
    await buildTask(task.taskId, 'a.ts', 'export const a = 1\n')
    await landFactoryRun(db, host, { runId: RUN }, { runner: passingRunner })
    const round = await startFactoryReview(db, host, { runId: RUN })
    if (round.kind === 'reviewer_needed') {
      await review(round.reviewTaskId, {
        verdict: 'fail',
        summary: 'Bad.',
        findings: [{ rule: 'r', problem: 'p' }]
      })
    }
    await expect(startFactoryReview(db, host, { runId: RUN })).rejects.toMatchObject({
      code: 'factory_needs_human'
    })
    await expect(createFactoryFixTask(db, host, { runId: RUN })).rejects.toMatchObject({
      code: 'factory_needs_human'
    })
  })

  it('does not count a dirty worker as verified', async () => {
    await runFactoryBaseline(
      db,
      host,
      { runId: RUN, worktreeSelector: `id:${repo.id}::${repo.path}` },
      { runner: passingRunner }
    )
    const [task] = applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: 'a' }] })
    const worktreeId = host.addWorktree('dirty', `factory/${RUN}`)
    const target = await host.resolveFactoryWorktreeTarget(`id:${worktreeId}`)
    startFactoryWorker(db, task.taskId, worktreeId)
    writeFileSync(join(target.worktree.path, 'app.ts'), 'export const app = 2\n')
    const outcome = await runFactoryVerify(db, host, { taskId: task.taskId }, passingRunner)
    expect(outcome).toMatchObject({ gated: true, result: { status: 'failed', ticket: 'none' } })
  })
})
