// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FactoryGateStatus } from '../../../../shared/factory-types'
import { FactoryGateSection } from './FactoryGateSection'

const gate = (overrides: Partial<FactoryGateStatus>): FactoryGateStatus => ({
  repoId: 'repo_app',
  repoName: 'app',
  command: 'pnpm test',
  enabled: false,
  stale: false,
  timeoutSeconds: null,
  approvedAt: null,
  unsupportedReason: null,
  ...overrides
})

let root: Root
let host: HTMLDivElement
const api = { list: vi.fn(), enable: vi.fn(), disable: vi.fn() }

async function render(gates: FactoryGateStatus[]): Promise<void> {
  api.list.mockResolvedValue(gates)
  await act(async () => {
    root.render(<FactoryGateSection />)
  })
}

const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === name
  )

describe('FactoryGateSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, { api: { factoryGate: api } })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('approves exactly the command the person reviewed', async () => {
    await render([gate({})])
    expect(host.textContent).toContain('pnpm test')
    expect(host.textContent).toContain('Off')

    await act(async () => buttonNamed('Enable')?.click())
    expect(document.body.textContent).toContain('Approve the factory quality gate')

    api.enable.mockResolvedValue(gate({ enabled: true }))
    await act(async () => buttonNamed('Approve and enable')?.click())
    expect(api.enable).toHaveBeenCalledWith({ repoId: 'repo_app', expectedCommand: 'pnpm test' })
  })

  it('asks for re-approval when the approved command changed', async () => {
    await render([gate({ enabled: true, stale: true })])
    expect(host.textContent).toContain('Needs re-approval')
    expect(buttonNamed('Review')).toBeDefined()
  })

  it('cannot be enabled where the gate is unsupported', async () => {
    await render([gate({ command: null, unsupportedReason: 'Add scripts.verify first.' })])
    expect(host.textContent).toContain('Add scripts.verify first.')
    expect(buttonNamed('Enable')?.disabled).toBe(true)
  })

  it('treats a missing desktop API as no repos instead of crashing', async () => {
    api.list.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<FactoryGateSection />)
    })
    expect(host.textContent).toContain('No repos yet.')
  })
})
