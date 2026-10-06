import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../db'
import { applyFactoryPlan, buildFactoryTaskSpec, orderFactoryPlan } from './factory-plan'

function factoryRun(baseline?: 'passed' | 'failed'): void {
  db.approveFactoryGate({ repoId: 'repo_p', contentHash: 'h', command: 'true', timeoutSeconds: 60 })
  db.upsertFactoryRun({
    runId: RUN,
    repoId: 'repo_p',
    baseBranch: null,
    maxWorkers: 1,
    maxFixRounds: 3
  })
  if (baseline) {
    db.recordFactoryCheck({
      run_id: RUN,
      kind: 'baseline',
      head_sha: 'abc',
      status: baseline,
      exit_code: baseline === 'passed' ? 0 : 2,
      timed_out: false,
      duration_ms: 1,
      output_tail: 'error TS2307: Cannot find module'
    })
  }
}

const RUN = 'run_legacy_local'
let db: OrchestrationDb

describe('factory plan', () => {
  afterEach(() => db?.close())

  it('orders dependencies before dependents regardless of input order', () => {
    const keys = orderFactoryPlan([
      { key: 'ui', spec: 'screen', deps: ['api'] },
      { key: 'api', spec: 'endpoint', deps: ['schema'] },
      { key: 'schema', spec: 'tables' }
    ]).map((task) => task.key)
    expect(keys).toEqual(['schema', 'api', 'ui'])
  })

  it.each([
    [[], /no tasks/],
    [
      [
        { key: 'a', spec: 'x' },
        { key: 'a', spec: 'y' }
      ],
      /appears twice/
    ],
    [[{ key: 'a', spec: 'x', deps: ['b'] }], /unknown key "b"/],
    [[{ key: 'a', spec: 'x', deps: ['a'] }], /depends on itself/],
    [[{ key: 'a', spec: '  ' }], /empty spec/],
    [[{ key: 'bad key', spec: 'x' }], /must be 1-64/],
    [
      [
        { key: 'a', spec: 'x', deps: ['b'] },
        { key: 'b', spec: 'y', deps: ['a'] }
      ],
      /cycle a → b → a/
    ]
  ])('rejects an invalid plan %#', (tasks, message) => {
    expect(() => orderFactoryPlan(tasks)).toThrow(message)
  })

  it('folds acceptance criteria into the spec workers receive', () => {
    expect(
      buildFactoryTaskSpec({ key: 'a', spec: 'Add refund API', acceptance: ['idempotent', ' '] })
    ).toBe(
      'Add refund API\n\n## Acceptance criteria\n- idempotent\n\n' +
        'Done means every criterion above holds and the repo verify command passes.'
    )
  })

  it('creates the whole graph with real dependency ids', () => {
    db = new OrchestrationDb(':memory:')
    const created = applyFactoryPlan(db, {
      runId: RUN,
      tasks: [
        { key: 'api', title: 'Refund API', spec: 'endpoint', deps: ['schema'] },
        { key: 'schema', spec: 'tables' }
      ]
    })
    const ids = Object.fromEntries(created.map((entry) => [entry.key, entry.taskId]))
    const api = db.getTask(ids.api)
    expect(JSON.parse(api?.deps ?? '[]')).toEqual([ids.schema])
    expect(db.getTask(ids.schema)?.status).toBe('ready')
    expect(api?.status).toBe('pending')
  })

  it('creates nothing when any task fails to create', () => {
    db = new OrchestrationDb(':memory:')
    const before = db.listTasks({ runId: RUN }).length
    expect(() =>
      applyFactoryPlan(db, { runId: 'run_does_not_exist', tasks: [{ key: 'a', spec: 'x' }] })
    ).toThrow()
    expect(db.listTasks({ runId: RUN })).toHaveLength(before)
  })

  it('requires a baseline before planning once any gate is on', () => {
    db = new OrchestrationDb(':memory:')
    db.approveFactoryGate({
      repoId: 'repo_p',
      contentHash: 'h',
      command: 'true',
      timeoutSeconds: 1
    })
    expect(() => applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: 'x' }] })).toThrow(
      /factory baseline --run/
    )
  })

  it('on a red baseline, allows only one root task and shows why', () => {
    db = new OrchestrationDb(':memory:')
    factoryRun('failed')
    expect(() =>
      applyFactoryPlan(db, {
        runId: RUN,
        tasks: [
          { key: 'a', spec: 'x' },
          { key: 'b', spec: 'y' }
        ]
      })
    ).toThrow(/ONE root task[\s\S]*TS2307/)
    expect(
      applyFactoryPlan(db, {
        runId: RUN,
        tasks: [
          { key: 'fix-base', spec: 'make tsc pass' },
          { key: 'b', spec: 'y', deps: ['fix-base'] }
        ]
      })
    ).toHaveLength(2)
  })

  it('on a green baseline, allows parallel roots', () => {
    db = new OrchestrationDb(':memory:')
    factoryRun('passed')
    const tasks = [
      { key: 'a', spec: 'x' },
      { key: 'b', spec: 'y' }
    ]
    expect(applyFactoryPlan(db, { runId: RUN, tasks })).toHaveLength(2)
  })

  it('refuses a worker past the run’s factory limit', () => {
    db = new OrchestrationDb(':memory:')
    factoryRun('passed')
    const [a, b] = applyFactoryPlan(db, {
      runId: RUN,
      tasks: [
        { key: 'a', spec: 'x' },
        { key: 'b', spec: 'y' }
      ]
    })
    const start = (taskId: string): unknown =>
      db.createStartingWorkerDispatch({
        creator: { kind: 'system' },
        maxDepth: Number.MAX_SAFE_INTEGER,
        taskId,
        startOptions: {}
      })
    start(a.taskId)
    expect(() => start(b.taskId)).toThrow(/factory limit/)
  })
})
