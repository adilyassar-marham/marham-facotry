// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'
import { FactoryRequestDetail } from './FactoryRequestDetail'

const request = (overrides: Partial<FactoryRequestView>): FactoryRequestView => ({
  id: 'freq_1',
  repoId: 'repo_app',
  title: 'hey',
  description: 'hey',
  agent: 'cursor',
  createdAt: new Date().toISOString(),
  cancelled: false,
  worktreeId: null,
  runId: null,
  stage: 'intake',
  progress: null,
  pendingQuestion: null,
  answeredQuestions: [],
  planApproval: null,
  planFeedback: null,
  plan: [],
  report: null,
  ...overrides
})

let root: Root
let host: HTMLDivElement
const cancel = vi.fn()

const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === name
  )

describe('factory request detail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cancel.mockResolvedValue(undefined)
    Object.assign(window, { api: { factoryRequests: { cancel } } })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('shows where a new message is, how long it has waited, and a way to stop it', async () => {
    const onChanged = vi.fn()
    await act(async () =>
      root.render(
        <FactoryRequestDetail
          request={request({ createdAt: new Date(Date.now() - 5 * 60_000).toISOString() })}
          now={Date.now()}
          onChanged={onChanged}
        />
      )
    )

    expect(host.textContent).toContain(
      'Still reading your message. Stop it if you don’t want to keep waiting.'
    )
    expect(host.textContent).toContain('5 min ago')
    expect(host.textContent).toContain('Using Cursor')
    expect(host.textContent).toContain('1. Reading')
    expect(host.querySelector('.animate-spin')).not.toBeNull()

    await act(async () => buttonNamed('Stop')?.click())

    expect(cancel).toHaveBeenCalledWith({ requestId: 'freq_1' })
    expect(onChanged).toHaveBeenCalled()
  })

  it('keeps Stop available while a decision is on screen, and hides it after cancel', async () => {
    await act(async () =>
      root.render(
        <FactoryRequestDetail
          request={request({ stage: 'plan_approval', planApproval: 'awaiting', runId: 'run_1' })}
          now={Date.now()}
          onChanged={vi.fn()}
        />
      )
    )
    expect(buttonNamed('Stop')).toBeDefined()

    await act(async () =>
      root.render(
        <FactoryRequestDetail
          request={request({ stage: 'cancelled' })}
          now={Date.now()}
          onChanged={vi.fn()}
        />
      )
    )
    expect(buttonNamed('Stop')).toBeUndefined()
    expect(host.textContent).toContain('This was cancelled.')
  })
})
