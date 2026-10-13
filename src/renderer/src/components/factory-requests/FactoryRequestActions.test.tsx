// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'
import {
  FactoryBriefCard,
  FactoryPlanApprovalCard,
  FactoryQuestionCard
} from './FactoryRequestActions'

const request = (overrides: Partial<FactoryRequestView>): FactoryRequestView => ({
  id: 'freq_1',
  repoId: 'repo_app',
  title: 'Show fee',
  description: 'On booking',
  agent: 'cursor',
  createdAt: '2026-10-07',
  cancelled: false,
  worktreeId: 'wt',
  runId: 'run_1',
  stage: 'plan_approval',
  progress: null,
  pendingQuestion: null,
  answeredQuestions: [],
  planApproval: 'awaiting',
  planFeedback: null,
  plan: [{ taskId: 'task_1', title: 'Fee label', spec: 'Add the fee label', status: 'ready' }],
  report: null,
  ...overrides
})

let root: Root
let host: HTMLDivElement
const api = { answer: vi.fn(), decidePlan: vi.fn(), decideBrief: vi.fn(), cancel: vi.fn() }

const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === name
  )

function typeInto(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('factory request actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, { api: { factoryRequests: api } })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('approves the plan the requester sees', async () => {
    const onChanged = vi.fn()
    await act(async () =>
      root.render(<FactoryPlanApprovalCard request={request({})} onChanged={onChanged} />)
    )
    api.decidePlan.mockResolvedValue(undefined)
    await act(async () => buttonNamed('Go ahead and build')?.click())
    expect(api.decidePlan).toHaveBeenCalledWith({ runId: 'run_1', approve: true })
    expect(onChanged).toHaveBeenCalled()
  })

  it('sends plan changes only with feedback', async () => {
    await act(async () =>
      root.render(<FactoryPlanApprovalCard request={request({})} onChanged={vi.fn()} />)
    )
    await act(async () => buttonNamed('Change the plan')?.click())
    expect(buttonNamed('Go ahead and build')).toBeTruthy()
    expect(buttonNamed('Build with these changes')?.disabled).toBe(true)
    const textarea = host.querySelector('textarea')
    await act(async () => (textarea ? typeInto(textarea, 'Also on receipt') : undefined))
    api.decidePlan.mockResolvedValue(undefined)
    await act(async () => buttonNamed('Build with these changes')?.click())
    expect(api.decidePlan).toHaveBeenCalledWith({
      runId: 'run_1',
      approve: true,
      feedback: 'Also on receipt'
    })
  })

  it('can ask to see the updated plan before building', async () => {
    await act(async () =>
      root.render(<FactoryPlanApprovalCard request={request({})} onChanged={vi.fn()} />)
    )
    await act(async () => buttonNamed('Change the plan')?.click())
    const textarea = host.querySelector('textarea')
    await act(async () => (textarea ? typeInto(textarea, 'Also on receipt') : undefined))
    api.decidePlan.mockResolvedValue(undefined)
    await act(async () => buttonNamed('Show me the updated plan')?.click())
    expect(api.decidePlan).toHaveBeenCalledWith({
      runId: 'run_1',
      approve: false,
      feedback: 'Also on receipt'
    })
  })

  it('answers the agent’s question', async () => {
    const pending = request({
      stage: 'question',
      pendingQuestion: { id: 'fq_1', question: 'Before discount?', answer: null, askedAt: '' }
    })
    await act(async () =>
      root.render(<FactoryQuestionCard request={pending} onChanged={vi.fn()} />)
    )
    const textarea = host.querySelector('textarea')
    await act(async () => (textarea ? typeInto(textarea, 'After') : undefined))
    api.answer.mockResolvedValue(undefined)
    await act(async () => buttonNamed('Send answer')?.click())
    expect(api.answer).toHaveBeenCalledWith({ questionId: 'fq_1', answer: 'After' })
  })

  it('answers a question by clicking a choice', async () => {
    const pending = request({
      stage: 'question',
      pendingQuestion: {
        id: 'frqq_1',
        question: 'What should get better?',
        answer: null,
        askedAt: '',
        choices: ['Save doctors they like', 'Pay faster'],
        recommended: 1,
        why: 'Only one of these fits.'
      }
    })
    await act(async () =>
      root.render(<FactoryQuestionCard request={pending} onChanged={vi.fn()} />)
    )
    api.answer.mockResolvedValue(undefined)
    await act(async () => buttonNamed('Save doctors they like · Suggested')?.click())
    expect(api.answer).toHaveBeenCalledWith({
      questionId: 'frqq_1',
      answer: 'Save doctors they like'
    })
  })

  it('approves the brief the person can read', async () => {
    const onChanged = vi.fn()
    await act(async () =>
      root.render(
        <FactoryBriefCard
          request={request({
            stage: 'awaiting_brief_approval',
            runId: null,
            brief: {
              version: 1,
              person: 'Patients can tap a heart on a doctor.',
              kind: 'app_only',
              acceptance: ['A heart is on each doctor.'],
              status: 'draft',
              feedback: null
            }
          })}
          onChanged={onChanged}
        />
      )
    )
    expect(host.textContent).toContain('Patients can tap a heart on a doctor.')
    api.decideBrief.mockResolvedValue(undefined)
    await act(async () => buttonNamed('Looks good, build it')?.click())
    expect(api.decideBrief).toHaveBeenCalledWith({ requestId: 'freq_1', approve: true })
    expect(onChanged).toHaveBeenCalled()
  })
})
