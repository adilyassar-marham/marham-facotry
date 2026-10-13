// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FactoryRequestsSheet } from './FactoryRequestsSheet'

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
    Object.assign(window, {
      api: {
        factoryRequests: {
          signedInAgents: vi.fn().mockResolvedValue([]),
          list: vi.fn().mockResolvedValue([]),
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
    expect(screen?.className).toContain('w-screen')
    expect(screen?.className).toContain('max-w-none')
    expect(screen?.className).not.toContain('w-3/4')
    expect(screen?.className).not.toContain('sm:max-w-[560px]')
    expect(document.querySelector('[data-slot="sheet-close"]')).not.toBeNull()
  })
})
