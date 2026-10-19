import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { FactorySkillLock } from './factory-skill-lock'

/** This skill documents the commands it blocks. Its matches are expected. */
const EXEMPT_SKILL = 'git-guardrails-claude-code'
const EXEMPT_RULES = new Set(['git-push', 'force'])

const ZERO_WIDTH = ['\u200B', '\u200C', '\u200D', '\uFEFF', '\u2060']
const HTML_COMMENT = /<!--[\s\S]*?-->/
const URL_PATTERN = /https?:\/\/[^\s)"'`<>]+/g

type Rule = { id: string; label: string; test: (text: string) => boolean }

const RULES: Rule[] = [
  { id: 'git-push', label: 'git push', test: (text) => /\bgit\s+push\b/.test(text) },
  {
    id: 'gh-pr',
    label: 'gh pr create or merge',
    test: (text) => /\bgh\s+pr\s+(create|merge)\b/.test(text)
  },
  { id: 'force', label: '--force', test: (text) => /--force\b/.test(text) },
  {
    id: 'pipe-shell',
    label: 'curl or wget piped to a shell',
    test: (text) => /\b(curl|wget)\b[^|\n]*\|\s*(ba)?sh\b/.test(text)
  },
  {
    id: 'base64',
    label: 'base64 blob',
    test: (text) =>
      /base64\s+(?:-d|--decode)\b/.test(text) ||
      /(?:^|[^A-Za-z0-9+/])[A-Za-z0-9+/]{100,}={0,2}(?:[^A-Za-z0-9+/=]|$)/.test(text)
  },
  {
    id: 'secrets',
    label: 'reading secrets or env files',
    test: (text) =>
      /\b(cat|source|open|read)\b[^\n]{0,80}\.env\b/.test(text) ||
      /\bcredentials\.json\b/.test(text) ||
      /\bid_rsa\b/.test(text)
  },
  {
    id: 'disable-checks',
    label: 'disabling hooks or checks',
    test: (text) => /--no-verify\b/.test(text) || /\bdisable\b[^\n]{0,40}\bhooks?\b/i.test(text)
  }
]

function walk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...walk(path))
    } else if (entry.isFile()) {
      found.push(path)
    }
  }
  return found
}

function urlProblem(text: string, allowlist: readonly string[]): string | null {
  for (const match of text.match(URL_PATTERN) ?? []) {
    let url: URL
    try {
      url = new URL(match)
    } catch {
      return `unreadable URL ${match}`
    }
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      continue
    }
    const parts = url.pathname.split('/').filter(Boolean)
    const slug = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : ''
    if (url.hostname === 'github.com' && allowlist.includes(`github.com/${slug}`)) {
      continue
    }
    return `URL outside the allowlist (${url.hostname})`
  }
  return null
}

/**
 * Refuses skills an agent would obey: push and PR commands, shell downloads, hidden text,
 * and scripts the lock did not pin by hash. git-guardrails-claude-code is exempt for the
 * push and --force lines it exists to block.
 */
export function scanFactorySkills(
  skillsDir: string,
  lock: FactorySkillLock,
  allowlist: readonly string[]
): string[] {
  if (!statSync(skillsDir, { throwIfNoEntry: false })?.isDirectory()) {
    return []
  }
  const problems: string[] = []
  for (const full of walk(skillsDir)) {
    const rel = relative(skillsDir, full).split(sep).join('/')
    const skill = rel.split('/')[0] ?? ''
    const text = readFileSync(full, 'utf8')
    const exempt = skill === EXEMPT_SKILL
    if (ZERO_WIDTH.some((character) => text.includes(character))) {
      problems.push(`${rel} contains hidden characters`)
    }
    const comment = HTML_COMMENT.exec(text)
    if (comment && comment[0].replace(/<!--|-->/g, '').trim()) {
      problems.push(`${rel} contains an HTML comment`)
    }
    for (const rule of RULES) {
      if (exempt && EXEMPT_RULES.has(rule.id)) {
        continue
      }
      if (rule.test(text)) {
        problems.push(`${rel} contains ${rule.label}`)
      }
    }
    const url = urlProblem(text, allowlist)
    if (url) {
      problems.push(`${rel} ${url}`)
    }
    if (!rel.endsWith('.md')) {
      const pinned = lock.allowedScripts[rel]
      if (!pinned) {
        problems.push(`${rel} is an executable the lock does not allow`)
      }
    }
  }
  return problems
}
