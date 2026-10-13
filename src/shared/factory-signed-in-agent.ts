const FACTORY_LOGIN_AGENTS = ['cursor', 'claude', 'codex'] as const

export type FactoryLoginAgent = (typeof FACTORY_LOGIN_AGENTS)[number]

function isFactoryLoginAgent(agent: string): agent is FactoryLoginAgent {
  return agent === 'cursor' || agent === 'claude' || agent === 'codex'
}

/**
 * The helper to offer first: the one they asked for when that login is already
 * on this computer, otherwise the first signed-in helper.
 */
export function chooseFactorySignedInAgent(
  requested: string,
  signedIn: ReadonlySet<string>
): string | null {
  if (!isFactoryLoginAgent(requested)) {
    return requested
  }
  if (signedIn.has(requested)) {
    return requested
  }
  return FACTORY_LOGIN_AGENTS.find((agent) => signedIn.has(agent)) ?? null
}

export function codexAuthFileIsSignedIn(raw: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return false
  }
  const apiKey = Object.getOwnPropertyDescriptor(parsed, 'OPENAI_API_KEY')?.value
  if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
    return true
  }
  const tokens = Object.getOwnPropertyDescriptor(parsed, 'tokens')?.value
  if (typeof tokens !== 'object' || tokens === null) {
    return false
  }
  const accessToken = Object.getOwnPropertyDescriptor(tokens, 'access_token')?.value
  return typeof accessToken === 'string' && accessToken.trim().length > 0
}
