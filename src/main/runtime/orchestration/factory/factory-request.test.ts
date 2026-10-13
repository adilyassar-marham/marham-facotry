import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { OrchestrationDb } from '../db'
import { runFactoryBaseline } from './factory-baseline'
import {
  approveGate,
  createFactoryHost,
  createFactoryRepo,
  passingRunner,
  startFactoryWorker
} from './factory-flow-test-fixture'
import { applyFactoryPlan } from './factory-plan'
import {
  askFactoryRequester,
  awaitFactoryPlanApproval,
  createFactoryRequestRecord,
  decideFactoryPlan
} from './factory-request'
import { decideFactoryBrief, submitFactoryBrief } from './factory-intake'
import { buildFactoryRequestView } from './factory-request-view'

const RUN = 'run_legacy_local'
let db: OrchestrationDb
let root: string
let repo: Repo
let host: ReturnType<typeof createFactoryHost>

function view(requestId: string): ReturnType<typeof buildFactoryRequestView> {
  const row = db.getFactoryRequest(requestId)
  if (!row) {
    throw new Error(`missing request ${requestId}`)
  }
  return buildFactoryRequestView(db, row)
}

async function startRequest(): Promise<string> {
  const created = createFactoryRequestRecord(db, {
    repoId: repo.id,
    title: 'Show fee on booking',
    description: 'Show the doctor fee under the name.',
    agent: 'cursor',
    cli: 'orca'
  })
  submitFactoryBrief(db, {
    requestId: created.requestId,
    brief: {
      person: 'Show the doctor fee under the name.',
      agent: 'Add the fee under the doctor name on the booking screen.',
      kind: 'app_only',
      acceptance: ['The fee is visible under the doctor name.']
    }
  })
  decideFactoryBrief(db, { requestId: created.requestId, approve: true })
  await runFactoryBaseline(
    db,
    host,
    { runId: RUN, worktreeSelector: `id:${repo.id}::${repo.path}`, requestId: created.requestId },
    { runner: passingRunner }
  )
  return created.requestId
}

describe('factory requests', () => {
  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    ;({ root, repo } = createFactoryRepo())
    host = createFactoryHost(root, repo)
    approveGate(db, repo)
  })
  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('writes a coordinator prompt that names the request, the agent and the rules', () => {
    const created = createFactoryRequestRecord(db, {
      repoId: repo.id,
      title: 'Show fee',
      description: 'On booking',
      agent: 'claude',
      cli: 'orca-dev'
    })
    expect(created.coordinatorPrompt).toContain(`--request ${created.requestId}`)
    expect(created.coordinatorPrompt).toContain('factory await-brief')
    expect(created.coordinatorPrompt).toContain('--agent claude')
    expect(created.coordinatorPrompt).toContain('orca-dev skills get factory')
    expect(created.coordinatorPrompt).toContain('never push')
    expect(() =>
      createFactoryRequestRecord(db, {
        repoId: repo.id,
        title: ' ',
        description: 'x',
        agent: 'claude',
        cli: 'orca'
      })
    ).toThrow(/title/)
  })

  it('links the run on baseline', async () => {
    const requestId = await startRequest()
    expect(db.getFactoryRequest(requestId)?.run_id).toBe(RUN)
    expect(view(requestId).stage).toBe('planning')
  })

  it('holds workers until the requester approves the plan', async () => {
    const requestId = await startRequest()
    const [task] = applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: 'fee label' }] })
    expect(view(requestId)).toMatchObject({ stage: 'plan_approval', planApproval: 'awaiting' })
    const worktreeId = host.addWorktree('w1', `factory/${RUN}`)
    expect(() => startFactoryWorker(db, task.taskId, worktreeId)).toThrow(/not approved/)
    expect(await awaitFactoryPlanApproval(db, { runId: RUN, waitSeconds: 0 })).toEqual({
      status: 'awaiting'
    })
    // A second plan cannot replace one the requester is still looking at.
    expect(() =>
      applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'b', spec: 'other' }] })
    ).toThrow(/waiting for the requester/)

    decideFactoryPlan(db, { runId: RUN, approve: true })
    expect(await awaitFactoryPlanApproval(db, { runId: RUN, waitSeconds: 0 })).toEqual({
      status: 'approved'
    })
    expect(() => startFactoryWorker(db, task.taskId, worktreeId)).not.toThrow()
    expect(view(requestId).stage).toBe('building')
  })

  it('retires the old unstarted tasks when the requester asks for changes', async () => {
    const requestId = await startRequest()
    const [old] = applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: 'first try' }] })
    expect(() => decideFactoryPlan(db, { runId: RUN, approve: false, feedback: ' ' })).toThrow(
      /what should change/
    )
    decideFactoryPlan(db, { runId: RUN, approve: false, feedback: 'Also on the receipt' })
    expect(await awaitFactoryPlanApproval(db, { runId: RUN, waitSeconds: 0 })).toEqual({
      status: 'changes_requested',
      feedback: 'Also on the receipt'
    })
    const [next] = applyFactoryPlan(db, {
      runId: RUN,
      tasks: [{ key: 'a2', spec: 'booking and receipt' }]
    })
    expect(db.getTask(old.taskId)?.status).toBe('failed')
    const current = view(requestId)
    expect(current.plan.map((task) => task.taskId)).toEqual([next.taskId])
    expect(current.planApproval).toBe('awaiting')
  })

  it('builds the requester’s changes without asking them to approve again', async () => {
    const requestId = await startRequest()
    const [old] = applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: 'first try' }] })
    const worktreeId = host.addWorktree('w1', `factory/${RUN}`)
    decideFactoryPlan(db, { runId: RUN, approve: true, feedback: 'Also on the receipt' })
    expect(await awaitFactoryPlanApproval(db, { runId: RUN, waitSeconds: 0 })).toEqual({
      status: 'approved',
      feedback: 'Also on the receipt'
    })
    expect(view(requestId).stage).toBe('planning')
    expect(() => startFactoryWorker(db, old.taskId, worktreeId)).toThrow(/with changes/)
    const [next] = applyFactoryPlan(db, {
      runId: RUN,
      tasks: [{ key: 'a2', spec: 'booking and receipt' }]
    })
    expect(db.getTask(old.taskId)?.status).toBe('failed')
    expect(db.getFactoryPlanApproval(RUN)).toMatchObject({ status: 'approved', feedback: null })
    expect(view(requestId).planApproval).toBe('approved')
    expect(() => startFactoryWorker(db, next.taskId, worktreeId)).not.toThrow()
  })

  it('carries a question to the requester and their answer back', async () => {
    const requestId = await startRequest()
    const asked = await askFactoryRequester(db, {
      runId: RUN,
      question: 'Before or after discount?',
      waitSeconds: 0
    })
    expect(asked.status).toBe('waiting')
    expect(view(requestId)).toMatchObject({
      stage: 'question',
      pendingQuestion: { question: 'Before or after discount?' }
    })
    const waiting = askFactoryRequester(db, {
      runId: RUN,
      questionId: asked.questionId,
      waitSeconds: 5
    })
    db.answerFactoryQuestion(asked.questionId, 'After')
    await expect(waiting).resolves.toEqual({
      status: 'answered',
      questionId: asked.questionId,
      answer: 'After'
    })
    expect(db.answerFactoryQuestion(asked.questionId, 'changed my mind')).toBe(false)
  })

  it('does not ask questions on a run no teammate requested', async () => {
    await expect(
      askFactoryRequester(db, { runId: RUN, question: 'Hm?', waitSeconds: 0 })
    ).rejects.toMatchObject({ code: 'factory_not_a_request' })
    await expect(awaitFactoryPlanApproval(db, { runId: RUN, waitSeconds: 0 })).resolves.toEqual({
      status: 'not_required'
    })
  })
})
