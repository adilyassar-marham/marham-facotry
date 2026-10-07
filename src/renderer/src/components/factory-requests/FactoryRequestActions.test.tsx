// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'
import { FactoryPlanApprovalCard, FactoryQuestionCard } from './FactoryRequestActions'

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
const api = { answer: vi.fn(), decidePlan: vi.fn() }

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
    expect(host.textContent).toContain('1. Fee label')
    api.decidePlan.mockResolvedValue(undefined)
    await act(async () => buttonNamed('Approve plan')?.click())
    expect(api.decidePlan).toHaveBeenCalledWith({ runId: 'run_1', approve: true })
    expect(onChanged).toHaveBeenCalled()
  })

  it('sends plan changes only with feedback', async () => {
    await act(async () =>
      root.render(<FactoryPlanApprovalCard request={request({})} onChanged={vi.fn()} />)
    )
    await act(async () => buttonNamed('Ask for changes')?.click())
    expect(buttonNamed('Send changes')?.disabled).toBe(true)
    const textarea = host.querySelector('textarea')
    await act(async () => (textarea ? typeInto(textarea, 'Also on receipt') : undefined))
    api.decidePlan.mockResolvedValue(undefined)
    await act(async () => buttonNamed('Send changes')?.click())
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
    expect(host.textContent).toContain('Before discount?')
    const textarea = host.querySelector('textarea')
    await act(async () => (textarea ? typeInto(textarea, 'After') : undefined))
    api.answer.mockResolvedValue(undefined)
    await act(async () => buttonNamed('Send answer')?.click())
    expect(api.answer).toHaveBeenCalledWith({ questionId: 'fq_1', answer: 'After' })
  })
})
