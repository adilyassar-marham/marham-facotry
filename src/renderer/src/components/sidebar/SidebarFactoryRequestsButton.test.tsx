// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFactoryTabOpen, setFactoryTabOpen } from '../factory-requests/factory-tab-store'
import { SidebarFactoryRequestsButton } from './SidebarFactoryRequestsButton'

const mocks = vi.hoisted(() => ({
  activeView: 'terminal',
  setActiveView: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: { activeView: string; setActiveView: typeof mocks.setActiveView }) => unknown
  ) => selector({ activeView: mocks.activeView, setActiveView: mocks.setActiveView })
}))

let root: Root
let host: HTMLDivElement

describe('sidebar factory button', () => {
  beforeEach(() => {
    mocks.activeView = 'terminal'
    mocks.setActiveView.mockReset()
    setFactoryTabOpen(false)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    setFactoryTabOpen(false)
  })

  it('opens the Factory tab as soon as the sidebar is there', async () => {
    await act(async () => {
      root.render(<SidebarFactoryRequestsButton />)
    })

    expect(getFactoryTabOpen()).toBe(true)
    expect(host.querySelector('button')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('lets them open the factory again after Issues is in front', async () => {
    mocks.activeView = 'tasks'
    await act(async () => {
      root.render(<SidebarFactoryRequestsButton />)
    })

    const button = host.querySelector('button')
    expect(getFactoryTabOpen()).toBe(false)
    expect(button?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => button?.click())

    expect(mocks.setActiveView).toHaveBeenCalledWith('terminal')
    expect(getFactoryTabOpen()).toBe(true)
  })
})
