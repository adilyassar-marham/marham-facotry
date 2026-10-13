import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readClaudeOAuthCredentials } from '../../../rate-limits/claude-oauth-credentials'
import { readCursorAuthSession } from '../../../rate-limits/cursor-auth'
import { codexAuthFileIsSignedIn } from '../../../../shared/factory-signed-in-agent'

async function claudeIsSignedIn(): Promise<boolean> {
  const credentials = await readClaudeOAuthCredentials()
  return credentials.token !== null || credentials.hasRefreshableCredentials
}

async function cursorIsSignedIn(): Promise<boolean> {
  const session = await readCursorAuthSession()
  return session.status === 'ok'
}

function codexIsSignedIn(): boolean {
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
  try {
    return codexAuthFileIsSignedIn(readFileSync(join(home, 'auth.json'), 'utf8'))
  } catch {
    return false
  }
}

/** Which of Cursor, Claude, and Codex already have a login on this computer. */
export async function factorySignedInAgents(): Promise<Set<string>> {
  const [claude, cursor] = await Promise.all([claudeIsSignedIn(), cursorIsSignedIn()])
  const signedIn = new Set<string>()
  if (cursor) {
    signedIn.add('cursor')
  }
  if (claude) {
    signedIn.add('claude')
  }
  if (codexIsSignedIn()) {
    signedIn.add('codex')
  }
  return signedIn
}
