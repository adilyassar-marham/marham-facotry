import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCommittedFactoryConfig } from '../../../../shared/factory-config'
import type { Repo } from '../../../../shared/repo-types'
import { OrchestrationDb } from '../db'
import { runFactoryBaseline } from './factory-baseline'
import {
  commitFile,
  createFactoryHost,
  createFactoryRepo,
  git,
  startFactoryWorker
} from './factory-flow-test-fixture'
import { enableManagedFactoryGate } from './factory-gate-approval'
import { landFactoryRun } from './factory-land'
import { applyFactoryPlan } from './factory-plan'
import { startFactoryReview } from './factory-review'
import { runFactoryVerify, type FactoryScriptRunner } from './factory-verify'

const RUN = 'run_legacy_local'
const TEAM_YAML = [
  'scripts:',
  '  setup: npm ci',
  '  verify: team-verify',
  'factory:',
  '  guidelines:',
  '    - docs/rules.md',
  '  maxWorkers: 2',
  '  maxFixRounds: 1',
  ''
].join('\n')

let db: OrchestrationDb
let root: string
let repo: Repo
let host: ReturnType<typeof createFactoryHost>
const scripts: string[] = []
const runner: FactoryScriptRunner = async ({ script }) => {
  scripts.push(script)
  return { success: true, output: 'ok', exitCode: 0 }
}

function commitTeamRules(yaml: string, rules: string): void {
  writeFileSync(join(repo.path, 'orca.yaml'), yaml)
  mkdirSync(join(repo.path, 'docs'), { recursive: true })
  writeFileSync(join(repo.path, 'docs', 'rules.md'), rules)
  git(repo.path, 'add', 'orca.yaml', 'docs/rules.md')
  git(repo.path, 'commit', '-qm', 'team rules')
  git(repo.path, 'push', '-q', String(join(root, 'remote.git')), 'main')
  git(repo.path, 'fetch', '-q', 'origin')
}

describe('committed team rules', () => {
  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    ;({ root, repo } = createFactoryRepo())
    host = createFactoryHost(root, repo)
    scripts.length = 0
  })
  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('parses only an explicit factory section with a verify command', () => {
    expect(parseCommittedFactoryConfig(TEAM_YAML)).toEqual({
      verify: 'team-verify',
      setup: 'npm ci',
      guidelines: ['docs/rules.md'],
      maxWorkers: 2,
      maxFixRounds: 1,
      skills: null,
      highRiskPaths: []
    })
    expect(parseCommittedFactoryConfig('scripts:\n  verify: x\n')).toBeNull()
    expect(
      parseCommittedFactoryConfig(
        'scripts:\n  verify: x\nfactory:\n  guidelines: [../etc, /abs, ok.md]\n'
      )?.guidelines
    ).toEqual(['ok.md'])
  })

  it('refuses to turn on team rules the base branch does not have', async () => {
    await expect(enableManagedFactoryGate(db, repo)).rejects.toThrow(/factory:/)
  })

  it('runs the committed rules, not local edits, and pins them for the whole run', async () => {
    commitTeamRules(TEAM_YAML, '# Team rules\n1. Small diffs\n')
    // A laptop's local edit must not change what the gate runs.
    writeFileSync(join(repo.path, 'orca.yaml'), 'scripts:\n  verify: echo always-pass\n')
    const gate = await enableManagedFactoryGate(db, repo)
    expect(gate).toMatchObject({ enabled: true, stale: false, managedBaseRef: 'origin/main' })

    await runFactoryBaseline(
      db,
      host,
      { runId: RUN, worktreeSelector: `id:${repo.id}::${repo.path}` },
      { runner }
    )
    expect(scripts).toEqual(['npm ci', 'team-verify'])
    expect(db.getFactoryRun(RUN)).toMatchObject({
      base_branch: 'origin/main',
      max_workers: 2,
      max_fix_rounds: 1
    })

    // Rules changed on the base branch after the run started do not reach this run.
    commitTeamRules(TEAM_YAML.replace('team-verify', 'newer-verify'), '# changed\n')

    const [task] = applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: 'a' }] })
    const worktreeId = host.addWorktree('t1', `factory/${RUN}`)
    const target = await host.resolveFactoryWorktreeTarget(`id:${worktreeId}`)
    startFactoryWorker(db, task.taskId, worktreeId)
    commitFile(target.worktree.path, 'a.ts', 'export const a = 1\n')
    const verify = await runFactoryVerify(db, host, { taskId: task.taskId }, runner)
    expect(verify).toMatchObject({ gated: true, command: 'team-verify' })
    db.settleWorkerReport({
      taskId: task.taskId,
      dispatchId: db.getDispatchContext(task.taskId)?.id ?? '',
      outcome: 'succeeded',
      result: 'done'
    })
    await landFactoryRun(db, host, { runId: RUN }, { runner })

    const round = await startFactoryReview(db, host, { runId: RUN })
    expect(round.kind).toBe('reviewer_needed')
    if (round.kind === 'reviewer_needed') {
      expect(round.guidelines).toHaveLength(1)
      expect(readFileSync(round.guidelines[0], 'utf8')).toBe('# Team rules\n1. Small diffs\n')
    }
  })
})
