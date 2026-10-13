import { readFileSync, rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { OrchestrationDb } from '../db'
import { runFactoryBaseline } from './factory-baseline'
import { INTAKE_PROMPT } from './factory-intake-prompt'
import {
  answerRequesterQuestion,
  askFactoryRequest,
  awaitFactoryBrief,
  decideFactoryBrief,
  sayFactoryRequest,
  submitFactoryBrief
} from './factory-intake'
import {
  approveGate,
  createFactoryHost,
  createFactoryRepo,
  passingRunner,
  startFactoryWorker
} from './factory-flow-test-fixture'
import { applyFactoryPlan } from './factory-plan'
import { createFactoryRequestRecord, decideFactoryPlan } from './factory-request'
import { buildFactoryRequestView } from './factory-request-view'

const RUN = 'run_legacy_local'
const VAGUE = 'make booking better'
const AGENT_V1 = 'Show a heart on each doctor. Save the tap locally.'
const AGENT_V2 = 'Show a heart on each doctor and keep the list on this phone.'

let db: OrchestrationDb
let root: string
let repo: Repo
let host: ReturnType<typeof createFactoryHost>

function view(requestId: string) {
  const row = db.getFactoryRequest(requestId)
  if (!row) {
    throw new Error(`missing request ${requestId}`)
  }
  return buildFactoryRequestView(db, row)
}

function openRequest(description = VAGUE): string {
  return createFactoryRequestRecord(db, {
    repoId: repo.id,
    title: 'Save doctors',
    description,
    agent: 'cursor',
    cli: 'orca-dev'
  }).requestId
}

const brief = (agent: string) => ({
  person: 'Patients can tap a heart on a doctor and see that list later.',
  agent,
  kind: 'app_only' as const,
  acceptance: ['A heart toggle is on each doctor.', 'The saved list is still there after restart.']
})

describe('factory intake', () => {
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

  it('ships the same intake instructions the coordinator reads', () => {
    const file = readFileSync(new URL('../../../../../prompts/intake.md', import.meta.url), 'utf8')
    expect(file).toBe(INTAKE_PROMPT)
    const created = createFactoryRequestRecord(db, {
      repoId: repo.id,
      title: 'Save doctors',
      description: VAGUE,
      agent: 'cursor',
      cli: 'orca-dev'
    })
    expect(created.coordinatorPrompt).toContain('orca-dev factory await-brief')
    expect(created.coordinatorPrompt).toContain('Do not create a run')
  })

  it('turns a vague request into a brief, a change, then an approved build prompt', async () => {
    const requestId = openRequest()
    expect(view(requestId).stage).toBe('intake')
    sayFactoryRequest(db, { requestId, text: 'You want booking to be easier for patients.' })

    const asked = await askFactoryRequest(db, {
      requestId,
      question: 'What should get better?',
      choices: ['Save doctors they like', 'Pay faster', 'See the fee'],
      recommended: 1,
      why: 'Booking covers all three, and only one fits this request.',
      waitSeconds: 0
    })
    expect(asked.status).toBe('waiting')
    expect(view(requestId).pendingQuestion?.choices).toEqual([
      'Save doctors they like',
      'Pay faster',
      'See the fee'
    ])
    const waiting = askFactoryRequest(db, {
      requestId,
      questionId: asked.questionId,
      waitSeconds: 5
    })
    expect(answerRequesterQuestion(db, asked.questionId, 'Save doctors they like')).toBe(true)
    await expect(waiting).resolves.toEqual({
      status: 'answered',
      questionId: asked.questionId,
      answer: 'Save doctors they like'
    })

    const first = submitFactoryBrief(db, { requestId, brief: brief(AGENT_V1) })
    expect(first).toEqual({ requestId, version: 1 })
    expect(view(requestId).stage).toBe('awaiting_brief_approval')
    expect(await awaitFactoryBrief(db, { requestId, waitSeconds: 0 })).toEqual({
      status: 'waiting',
      version: 1
    })
    // A second submit while it is still a draft replaces that version.
    expect(submitFactoryBrief(db, { requestId, brief: brief(AGENT_V1) }).version).toBe(1)

    decideFactoryBrief(db, { requestId, approve: false, feedback: 'Keep the list on this phone.' })
    expect(await awaitFactoryBrief(db, { requestId, waitSeconds: 0 })).toEqual({
      status: 'changes_requested',
      version: 1,
      feedback: 'Keep the list on this phone.'
    })
    const second = submitFactoryBrief(db, { requestId, brief: brief(AGENT_V2) })
    expect(second.version).toBe(2)
    decideFactoryBrief(db, { requestId, approve: true })
    const approved = await awaitFactoryBrief(db, { requestId, waitSeconds: 0 })
    expect(approved).toEqual({ status: 'approved', version: 2, agent: AGENT_V2 })
    expect(() => submitFactoryBrief(db, { requestId, brief: brief('again') })).toThrow(
      /already has an approved brief/
    )
  })

  it('refuses a worker until the brief is approved, then allows the build', async () => {
    const requestId = openRequest()
    await runFactoryBaseline(
      db,
      host,
      { runId: RUN, worktreeSelector: `id:${repo.id}::${repo.path}`, requestId },
      { runner: passingRunner }
    )
    const [task] = applyFactoryPlan(db, { runId: RUN, tasks: [{ key: 'a', spec: AGENT_V2 }] })
    const worktreeId = host.addWorktree('w1', `factory/${RUN}`)
    decideFactoryPlan(db, { runId: RUN, approve: true })
    expect(() => startFactoryWorker(db, task.taskId, worktreeId)).toThrow(/no approved brief/)
    submitFactoryBrief(db, { requestId, brief: brief(AGENT_V2) })
    decideFactoryBrief(db, { requestId, approve: true })
    const approved = await awaitFactoryBrief(db, { requestId, waitSeconds: 0 })
    expect(approved).toMatchObject({ status: 'approved', agent: AGENT_V2 })
    expect(() => startFactoryWorker(db, task.taskId, worktreeId)).not.toThrow()
  })
})
