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
  builtin: false,
  enabled: false,
  stale: false,
  timeoutSeconds: null,
  approvedAt: null,
  unsupportedReason: null,
  settings: { guidelines: ['.cursor/rules/code.mdc'], maxWorkers: 3, maxFixRounds: 3 },
  managedBaseRef: null,
  teamRules: null,
  ...overrides
})

let root: Root
let host: HTMLDivElement
const api = {
  list: vi.fn(),
  enable: vi.fn(),
  enableManaged: vi.fn(),
  disable: vi.fn(),
  saveSettings: vi.fn(),
  openPullRequest: vi.fn()
}

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

  it('lists committed skills and says when the lock never recorded a sync', async () => {
    await render([
      gate({
        skillCatalog: {
          syncedAt: null,
          entries: [
            {
              stage: 'build',
              skill: 'sharpen',
              source: 'backnotprop/pstack',
              pinnedCommit: 'abc123def456'
            }
          ]
        }
      })
    ])
    expect(host.textContent).toContain('Skills · app')
    expect(host.textContent).toContain('build')
    expect(host.textContent).toContain('sharpen')
    expect(host.textContent).toContain('not recorded')
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
    // Nothing to approve and no team rules: no way to turn it on from here.
    expect(buttonNamed('Enable')).toBeUndefined()
    expect(buttonNamed('Use team rules')).toBeUndefined()
  })

  it('treats a missing desktop API as no repos instead of crashing', async () => {
    api.list.mockResolvedValue(undefined)
    await act(async () => {
      root.render(<FactoryGateSection />)
    })
    expect(host.textContent).toContain('No repos yet.')
  })

  it('saves guideline files and limits the person edited', async () => {
    await render([gate({})])
    expect(host.textContent).toContain('Review against .cursor/rules/code.mdc')
    await act(async () => buttonNamed('Settings')?.click())
    const textarea = document.body.querySelector('textarea')
    expect(textarea?.value).toBe('.cursor/rules/code.mdc')

    api.saveSettings.mockResolvedValue(gate({}))
    await act(async () => buttonNamed('Save')?.click())
    expect(api.saveSettings).toHaveBeenCalledWith({
      repoId: 'repo_app',
      guidelines: ['.cursor/rules/code.mdc'],
      maxWorkers: 3,
      maxFixRounds: 3
    })
  })

  it('offers the team rules from the base branch in one click', async () => {
    await render([
      gate({
        command: null,
        unsupportedReason: 'Add `scripts.verify` to this repo’s orca.yaml to enable the gate.',
        teamRules: { baseRef: 'origin/master', verify: 'npx tsc --noEmit', guidelines: [] }
      })
    ])
    expect(host.textContent).toContain('npx tsc --noEmit')
    expect(buttonNamed('Enable')).toBeUndefined()
    api.enableManaged.mockResolvedValue(gate({ enabled: true, managedBaseRef: 'origin/master' }))
    await act(async () => buttonNamed('Use team rules')?.click())
    expect(api.enableManaged).toHaveBeenCalledWith({ repoId: 'repo_app' })
  })

  it('shows a managed gate as team rules, without local settings', async () => {
    await render([gate({ enabled: true, managedBaseRef: 'origin/master' })])
    expect(host.textContent).toContain('Team rules from origin/master')
    expect(buttonNamed('Settings')).toBeUndefined()
    expect(buttonNamed('Turn off')).toBeDefined()
  })
})
