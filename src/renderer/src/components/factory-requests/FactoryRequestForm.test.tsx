// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FactoryGateStatus } from '../../../../shared/factory-types'
import { FactoryRequestForm } from './FactoryRequestForm'

const mocks = vi.hoisted(() => {
  const settings: {
    defaultTuiAgent: string | null
    disabledTuiAgents: Iterable<string> | undefined
    activeClaudeManagedAccountId: string | null
    activeCodexManagedAccountId: string | null
  } = {
    defaultTuiAgent: 'claude',
    disabledTuiAgents: undefined,
    activeClaudeManagedAccountId: null,
    activeCodexManagedAccountId: null
  }
  return {
    settings,
    updateSettings: vi.fn(),
    fetchSettings: vi.fn(),
    detectedIds: ['claude', 'cursor', 'codex'],
    claudeAdd: vi.fn(),
    codexAdd: vi.fn(),
    claudeCancel: vi.fn(),
    codexCancel: vi.fn()
  }
})

vi.mock('@/store', () => ({
  useAppStore: (
    selector: (state: {
      settings: typeof mocks.settings
      updateSettings: typeof mocks.updateSettings
      fetchSettings: typeof mocks.fetchSettings
    }) => unknown
  ) =>
    selector({
      settings: mocks.settings,
      updateSettings: mocks.updateSettings,
      fetchSettings: mocks.fetchSettings
    })
}))

vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: () => ({ detectedIds: mocks.detectedIds, isLoading: false })
}))

const gate: FactoryGateStatus = {
  repoId: 'repo_app',
  repoName: 'App',
  command: null,
  builtin: true,
  enabled: true,
  stale: false,
  timeoutSeconds: null,
  approvedAt: null,
  unsupportedReason: null,
  settings: { guidelines: [], maxWorkers: 1, maxFixRounds: 1 },
  managedBaseRef: null,
  teamRules: null
}

let root: Root
let host: HTMLDivElement

const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === name
  )

describe('factory request form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settings.defaultTuiAgent = 'claude'
    mocks.settings.activeClaudeManagedAccountId = null
    mocks.settings.activeCodexManagedAccountId = null
    mocks.detectedIds = ['claude', 'cursor', 'codex']
    mocks.fetchSettings.mockResolvedValue(undefined)
    mocks.updateSettings.mockResolvedValue(undefined)
    mocks.claudeAdd.mockResolvedValue(undefined)
    mocks.codexAdd.mockResolvedValue(undefined)
    Object.assign(window, {
      api: {
        claudeAccounts: { add: mocks.claudeAdd, cancelPendingLogin: mocks.claudeCancel },
        codexAccounts: { add: mocks.codexAdd, cancelPendingLogin: mocks.codexCancel },
        factoryRequests: { create: vi.fn() }
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

  const renderForm = async (
    signedInIds: string[] | null,
    onOpenAccounts = vi.fn(),
    onSignedIn = vi.fn()
  ): Promise<{
    onOpenAccounts: ReturnType<typeof vi.fn>
    onSignedIn: ReturnType<typeof vi.fn>
  }> => {
    await act(async () =>
      root.render(
        <FactoryRequestForm
          gates={[gate]}
          signedInIds={signedInIds}
          onCreated={vi.fn()}
          onGatesChanged={vi.fn()}
          onSignedIn={onSignedIn}
          onOpenAccounts={onOpenAccounts}
        />
      )
    )
    return { onOpenAccounts, onSignedIn }
  }

  it('uses a login already on this computer', async () => {
    await renderForm(['codex'])

    expect(host.textContent).toContain('Using ChatGPT.')
    expect(buttonNamed('Sign in to Claude')).toBeUndefined()
    await act(async () => buttonNamed('Show the doctor fee on the booking screen')?.click())
    expect(buttonNamed('Send')?.disabled).toBe(false)
  })

  it('asks them to sign in to Claude or ChatGPT when neither is signed in', async () => {
    const { onSignedIn } = await renderForm([])

    expect(buttonNamed('Send')?.disabled).toBe(true)
    await act(async () => buttonNamed('Sign in to Claude')?.click())
    expect(mocks.claudeAdd).toHaveBeenCalledOnce()
    expect(mocks.fetchSettings).toHaveBeenCalledOnce()
    expect(onSignedIn).toHaveBeenCalledOnce()

    await act(async () => buttonNamed('Sign in to ChatGPT')?.click())
    expect(mocks.codexAdd).toHaveBeenCalledOnce()
  })

  it('opens the Cursor account page when Cursor is the only helper', async () => {
    mocks.detectedIds = ['cursor']
    const { onOpenAccounts } = await renderForm([])

    await act(async () => buttonNamed('Sign in to Cursor')?.click())
    expect(onOpenAccounts).toHaveBeenCalledWith('accounts-cursor')
    expect(mocks.claudeAdd).not.toHaveBeenCalled()
  })

  it('lets them send once Claude is already signed in', async () => {
    mocks.settings.activeClaudeManagedAccountId = 'account-1'
    await renderForm([])

    expect(host.textContent).toContain('Using Claude.')
    expect(buttonNamed('Sign in to Claude')).toBeUndefined()
    await act(async () => buttonNamed('Show the doctor fee on the booking screen')?.click())
    expect(buttonNamed('Send')?.disabled).toBe(false)
  })
})
