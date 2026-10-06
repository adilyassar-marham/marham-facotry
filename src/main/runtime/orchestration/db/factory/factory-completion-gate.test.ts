import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../db'
import { reattachDispatchConsumer } from '../root-dispatch-test-fixture'

const REPO_ID = 'repo_factory'
const WORKTREE_ID = `${REPO_ID}::/work/feature-a`
let db: OrchestrationDb

function startWorker(worktreeId: string | null = WORKTREE_ID): {
  taskId: string
  dispatchId: string
} {
  const task = db.createTask({ runId: 'run_legacy_local', spec: 'build feature A' })
  const started = db.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    taskId: task.id,
    startOptions: {}
  })
  reattachDispatchConsumer(db, {
    dispatchId: started.dispatch.id,
    paneKey: 'tab_worker:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    processIncarnation: 'runtime_test:term_worker:1'
  })
  if (worktreeId) {
    db.recordWorkerStage({ dispatchId: started.dispatch.id, stage: 'running', worktreeId })
  }
  return { taskId: task.id, dispatchId: started.dispatch.id }
}

function enableGate(): void {
  db.approveFactoryGate({
    repoId: REPO_ID,
    contentHash: 'hash',
    command: 'pnpm test',
    timeoutSeconds: 600
  })
}

function recordVerify(taskId: string, dispatchId: string, passed: boolean): void {
  const id = db.beginFactoryVerify({ taskId, dispatchId, worktreeId: WORKTREE_ID })
  db.finishFactoryVerify({
    id,
    status: passed ? 'passed' : 'failed',
    exitCode: passed ? 0 : 1,
    timedOut: false,
    durationMs: 10,
    outputTail: passed ? 'ok' : 'FAIL src/a.test.ts'
  })
}

const succeed = (taskId: string, dispatchId: string) =>
  db.settleWorkerReport({ taskId, dispatchId, outcome: 'succeeded', result: 'done' })

describe('factory completion gate', () => {
  afterEach(() => db?.close())

  it('leaves repos without an approved gate untouched', () => {
    db = new OrchestrationDb(':memory:')
    const { taskId, dispatchId } = startWorker()
    expect(succeed(taskId, dispatchId)).toMatchObject({ action: 'settled', outcome: 'succeeded' })
    expect(db.getTask(taskId)?.status).toBe('completed')
  })

  it('refuses a gated worker success that has no passing verify', () => {
    db = new OrchestrationDb(':memory:')
    enableGate()
    const { taskId, dispatchId } = startWorker()
    expect(succeed(taskId, dispatchId)).toMatchObject({
      action: 'rejected',
      code: 'factory_verify_required'
    })
    expect(db.getTask(taskId)?.status).not.toBe('completed')
  })

  it('completes a gated task by spending exactly one pass ticket', () => {
    db = new OrchestrationDb(':memory:')
    enableGate()
    const { taskId, dispatchId } = startWorker()
    recordVerify(taskId, dispatchId, true)
    expect(succeed(taskId, dispatchId)).toMatchObject({ action: 'settled', duplicate: false })
    expect(db.getTask(taskId)?.status).toBe('completed')
    expect(db.listLatestFactoryVerifyResults([taskId]).get(taskId)?.ticket).toBe('consumed')
  })

  it('never lets an older pass outlive a newer failing verify', () => {
    db = new OrchestrationDb(':memory:')
    enableGate()
    const { taskId, dispatchId } = startWorker()
    recordVerify(taskId, dispatchId, true)
    recordVerify(taskId, dispatchId, false)
    expect(succeed(taskId, dispatchId)).toMatchObject({ code: 'factory_verify_required' })
  })

  it('always lets a worker report failure', () => {
    db = new OrchestrationDb(':memory:')
    enableGate()
    const { taskId, dispatchId } = startWorker()
    expect(
      db.settleWorkerReport({ taskId, dispatchId, outcome: 'failed', result: 'tests broke' })
    ).toMatchObject({ action: 'settled', outcome: 'failed' })
  })

  it('does not gate tasks whose worker has no local worktree', () => {
    db = new OrchestrationDb(':memory:')
    enableGate()
    const { taskId, dispatchId } = startWorker(null)
    expect(succeed(taskId, dispatchId)).toMatchObject({ action: 'settled' })
  })

  it('gates the coordinator taskUpdate door the same way', () => {
    db = new OrchestrationDb(':memory:')
    enableGate()
    const { taskId, dispatchId } = startWorker()
    db.recordWorkerStage({ dispatchId, stage: 'stopped', state: 'stopped' })
    expect(() => db.updateTaskStatus(taskId, 'completed', 'by hand')).toThrow(
      expect.objectContaining({ code: 'factory_verify_required' })
    )
    expect(db.getTask(taskId)?.status).not.toBe('completed')
    recordVerify(taskId, dispatchId, true)
    expect(db.updateTaskStatus(taskId, 'completed', 'by hand')?.status).toBe('completed')
  })

  it('keeps repo approvals across a task reset but drops run state', () => {
    db = new OrchestrationDb(':memory:')
    enableGate()
    const { taskId, dispatchId } = startWorker()
    recordVerify(taskId, dispatchId, true)
    db.resetTasks()
    expect(db.getFactoryGateApproval(REPO_ID)).toBeDefined()
    expect(db.listLatestFactoryVerifyResults([taskId]).size).toBe(0)
  })
})
