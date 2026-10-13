export type FactoryManagedAccounts = {
  claude: boolean
  codex: boolean
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
