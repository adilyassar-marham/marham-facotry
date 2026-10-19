import { translate } from '@/i18n/i18n'

export type FactoryManagedAccounts = {
  claude: boolean
  codex: boolean
}

const FACTORY_HELPER_ORDER = ['claude', 'codex', 'cursor'] as const

/** What a requester sees. Codex is the ChatGPT login on this computer. */
export function factoryHelperLabel(agent: string): string {
  switch (agent) {
    case 'claude':
      return translate('auto.components.factoryRequests.agent.claude', 'Claude')
    case 'codex':
      return translate('auto.components.factoryRequests.agent.codex', 'ChatGPT')
    case 'cursor':
      return translate('auto.components.factoryRequests.agent.cursor', 'Cursor')
    default:
      return agent
  }
}

/**
 * A login already on this computer wins. Their saved choice is used when that
 * login is present; otherwise Claude, then ChatGPT, then Cursor.
 */
export function factoryAutomaticHelper(
  requested: string | null | undefined,
  available: readonly string[],
  signedIn: readonly string[],
  managed: FactoryManagedAccounts
): string | null {
  const ready = (agent: string): boolean =>
    available.includes(agent) && factoryHelperIsIntegrated(agent, signedIn, managed)
  if (requested && requested !== 'blank' && ready(requested)) {
    return requested
  }
  return FACTORY_HELPER_ORDER.find(ready) ?? available[0] ?? null
}

/** The helper they already picked, when it is installed. Otherwise the first one on this computer. */
export function factoryPreferredHelper(
  defaultAgent: string | null | undefined,
  available: readonly string[]
): string | null {
  if (defaultAgent && defaultAgent !== 'blank' && available.includes(defaultAgent)) {
    return defaultAgent
  }
  return available[0] ?? null
}

export function factoryHelperHasAccountSignIn(
  agent: string
): agent is 'cursor' | 'claude' | 'codex' {
  return agent === 'cursor' || agent === 'claude' || agent === 'codex'
}

/** A system login or an account already added in Orca. Other helpers have no sign-in here. */
export function factoryHelperIsIntegrated(
  agent: string,
  signedInIds: readonly string[],
  managed: FactoryManagedAccounts
): boolean {
  if (signedInIds.includes(agent)) {
    return true
  }
  if (agent === 'claude') {
    return managed.claude
  }
  if (agent === 'codex') {
    return managed.codex
  }
  return !factoryHelperHasAccountSignIn(agent)
}
