import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../db'
import { runFactoryBaseline } from './factory-baseline'
import {
  approveGate,
  commitFile,
  createFactoryHost,
  createFactoryRepo,
  passingRunner,
  startFactoryWorker
} from './factory-flow-test-fixture'
import { applyFactoryPlan } from './factory-plan'
import { buildFactoryPrBody } from './factory-pr-body'
import { enforceFactoryGateBeforeWorkerSuccess } from './factory-worker-done-gate'

const RUN = 'run_legacy_local'
const SHA = 'a'.repeat(64)
const PIN = 'b'.repeat(40)

describe('skill-pack evidence and PR listing', () => {
  let db: OrchestrationDb
  let root: string
  let repo: ReturnType<typeof createFactoryRepo>['repo']
  let host: ReturnType<typeof createFactoryHost>

  beforeEach(async () => {
    db = new OrchestrationDb(':memory:')
    ;({ root, repo } = createFactoryRepo())
    host = createFactoryHost(root, repo)
    approveGate(db, repo)
    await runFactoryBaseline(
      db,
      host,
      { runId: RUN, worktreeSelector: `id:${repo.id}::${repo.path}` },
      { runner: passingRunner }
    )
    db.replaceFactorySkillSnapshot({
      runId: RUN,
      pack: {
        run_id: RUN,
        base_commit: PIN,
        pack: '.agents/skills',
        overlays: '.agents/skills-overlays',
        budget_chars: 60000
      },
      skills: [
        {
          run_id: RUN,
          stage: 'build',
          skill: 'sharpen',
          sha256: SHA,
          source: 'backnotprop/pstack',
          pinned_commit: PIN
        },
        {
          run_id: RUN,
          stage: 'review',
          skill: 'sharpen',
          sha256: SHA,
          source: 'backnotprop/pstack',
          pinned_commit: PIN
        }
      ],
      paths: []
    })
  })

  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('refuses a build with no Evidence section, then accepts a command and its result', async () => {
    const [task] = applyFactoryPlan(db, {
      runId: RUN,
      tasks: [{ key: 'api', title: 'Add API', spec: 'add api.ts', acceptance: ['exports api'] }]
    })
    const worktreeId = host.addWorktree('task-evidence', `factory/${RUN}`)
    const target = await host.resolveFactoryWorktreeTarget(`id:${worktreeId}`)
    const dispatchId = startFactoryWorker(db, task.taskId, worktreeId)
    commitFile(target.worktree.path, 'api.ts', 'export const api = 1\n')
    await expect(
      enforceFactoryGateBeforeWorkerSuccess(
        db,
        host,
        { dispatchId, outcome: 'succeeded' },
        passingRunner
      )
    ).rejects.toMatchObject({ code: 'factory_evidence_missing' })

    mkdirSync(join(target.worktree.path, '.orca'), { recursive: true })
    commitFile(
      target.worktree.path,
      '.orca/report.md',
      '## Evidence\n- Gate: echo ok → ok\n- Criteria: exports api → node -e → 1\n'
    )
    await enforceFactoryGateBeforeWorkerSuccess(
      db,
      host,
      { dispatchId, outcome: 'succeeded', reportPath: '.orca/report.md' },
      passingRunner
    )
    expect(
      db.settleWorkerReport({
        taskId: task.taskId,
        dispatchId,
        outcome: 'succeeded',
        result: 'done'
      })
    ).toMatchObject({ action: 'settled' })
  })

  it('lists each skill once and records smells without their text', () => {
    const review = db.createFactoryReview({
      runId: RUN,
      round: 1,
      taskId: null,
      headSha: PIN,
      verdict: 'fail',
      summary: 'one smell',
      findings: '[]'
    })
    db.recordFactoryReviewDetails({
      review_id: review.id,
      standards_json: '[]',
      spec_json: '[]',
      smells_json: JSON.stringify([
        { name: 'Feature envy', file: 'api.ts', note: 'could be local' }
      ]),
      blast_json: '[]'
    })
    const body = buildFactoryPrBody(db, {
      runId: RUN,
      objective: 'Add API',
      verifyCommand: 'npm test',
      guidelines: []
    })
    expect(body.match(/sharpen/g)).toHaveLength(1)
    expect(body).toContain(SHA)
    expect(body).toContain(PIN)
    expect(body).toContain('Feature envy (api.ts): could be local')
    expect(body).not.toContain('# first skill')
  })
})
