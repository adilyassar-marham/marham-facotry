// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FactoryRequestsSheet } from './FactoryRequestsSheet'

const listRequests = vi.hoisted(() => vi.fn())

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { openSettingsTarget: () => void }) => unknown) =>
    selector({ openSettingsTarget: vi.fn() })
}))

vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: () => ({ detectedIds: [], isLoading: false })
}))

let root: Root
let host: HTMLDivElement

describe('factory requests sheet', () => {
  beforeEach(() => {
    listRequests.mockReset()
    listRequests.mockResolvedValue([])
    Object.assign(window, {
      api: {
        factoryRequests: {
          signedInAgents: vi.fn().mockResolvedValue([]),
          list: listRequests,
          create: vi.fn()
        },
        factoryGate: { list: vi.fn().mockResolvedValue([]) }
      }
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('covers the whole window and keeps a close button', async () => {
    await act(async () => {
      root.render(<FactoryRequestsSheet open onOpenChange={vi.fn()} />)
    })

    const screen = document.querySelector('[data-slot="sheet-content"]')
    expect(screen?.className).toContain('inset-0')
    expect(screen?.className).toContain('w-screen')
    expect(screen?.className).toContain('max-w-none')
    expect(screen?.className).not.toContain('w-3/4')
    expect(screen?.className).not.toContain('sm:max-w-[560px]')
    expect(document.body.textContent).toContain('Close')
    expect(document.body.textContent).not.toContain('Nothing in progress')
    expect(document.querySelector('[data-slot="sheet-content"] .titlebar')).not.toBeNull()
    expect(document.querySelector('[data-slot="sheet-close"]')).not.toBeNull()
  })

  it('leaves the corner clear when every old request is already finished', async () => {
    listRequests.mockResolvedValue([
      {
        id: 'freq_old',
        repoId: 'repo',
        title: 'hey',
        description: 'hey',
        agent: 'claude',
        createdAt: '2026-10-13 09:04:28',
        cancelled: true,
        worktreeId: null,
        runId: null,
        stage: 'cancelled',
        progress: null,
        pendingQuestion: null,
        answeredQuestions: [],
        planApproval: null,
        planFeedback: null,
        plan: [],
        report: null
      }
    ])
    await act(async () => {
      root.render(<FactoryRequestsSheet open onOpenChange={vi.fn()} />)
    })
    await act(async () => {
      await listRequests.mock.results[0]?.value
    })

    expect(document.body.textContent).toContain('Past requests')
    expect(document.body.textContent).not.toContain('Nothing in progress')
    expect(document.body.textContent).not.toContain('New request')
  })
})
