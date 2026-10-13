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

  it('keeps the helper they first chose and signs that one in', async () => {
    const { onSignedIn } = await renderForm(['cursor'])

    expect(buttonNamed('Claude')?.getAttribute('aria-pressed')).toBe('true')
    expect(host.textContent).toContain(
      'Claude needs a sign-in on this computer before it can work.'
    )
    expect(buttonNamed('Send')?.disabled).toBe(true)

    await act(async () => buttonNamed('Sign in')?.click())

    expect(mocks.claudeAdd).toHaveBeenCalledOnce()
    expect(mocks.fetchSettings).toHaveBeenCalledOnce()
    expect(onSignedIn).toHaveBeenCalledOnce()
  })

  it('opens the existing Cursor account page when they switch to Cursor', async () => {
    const { onOpenAccounts } = await renderForm([])

    await act(async () => buttonNamed('Cursor')?.click())

    expect(mocks.updateSettings).toHaveBeenCalledWith({ defaultTuiAgent: 'cursor' })
    expect(host.textContent).toContain('Cursor signs in through the Cursor app.')
    await act(async () => buttonNamed('Sign in')?.click())
    expect(onOpenAccounts).toHaveBeenCalledWith('accounts-cursor')
    expect(mocks.claudeAdd).not.toHaveBeenCalled()
  })

  it('lets them send once that helper is already signed in', async () => {
    mocks.settings.activeClaudeManagedAccountId = 'account-1'
    await renderForm([])

    expect(buttonNamed('Sign in')).toBeUndefined()
    await act(async () => buttonNamed('Show the doctor fee on the booking screen')?.click())
    expect(buttonNamed('Send')?.disabled).toBe(false)
  })
})
