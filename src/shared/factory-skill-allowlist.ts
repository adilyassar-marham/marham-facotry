import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Engineer-owned. A lock file cannot add a source by naming it. */
export const DEFAULT_FACTORY_SKILL_ALLOWLIST = [
  'github.com/backnotprop/pstack',
  'github.com/mattpocock/skills',
  'github.com/EAIconsulting/mattpock-skills'
] as const

const SOURCE_PATTERN =
  /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\s+\(mirror:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\))?$/

export function factorySkillAllowlistPath(userDataPath: string): string {
  return join(userDataPath, 'factory-skill-allowlist.json')
}

/** Missing or unreadable settings keep the defaults. The repo never supplies this list. */
export function readFactorySkillAllowlist(userDataPath: string): string[] {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(factorySkillAllowlistPath(userDataPath), 'utf8')
    )
    const sources =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.getOwnPropertyDescriptor(parsed, 'sources')?.value
        : undefined
    if (!Array.isArray(sources)) {
      return [...DEFAULT_FACTORY_SKILL_ALLOWLIST]
    }
    const allowed = sources.filter(
      (entry): entry is string =>
        typeof entry === 'string' && /^github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry)
    )
    return allowed.length > 0 ? allowed : [...DEFAULT_FACTORY_SKILL_ALLOWLIST]
  } catch {
    return [...DEFAULT_FACTORY_SKILL_ALLOWLIST]
  }
}

export type ResolvedSkillSource = { slug: string; url: string; named: string[] }

/**
 * The fetch URL is the mirror when the lock names one, otherwise the primary repo.
 * Every named repo must sit on the allowlist.
 */
export function resolveSkillSource(
  source: string,
  allowlist: readonly string[]
): ResolvedSkillSource {
  const match = SOURCE_PATTERN.exec(source.trim())
  if (!match) {
    throw new Error(
      `Skill source "${source}" is not an allowlisted GitHub repo. ` +
        `Sync only fetches: ${allowlist.join(', ')}.`
    )
  }
  const named = [match[1], match[2]].filter((slug): slug is string => Boolean(slug))
  const blocked = named.filter((slug) => !allowlist.includes(`github.com/${slug}`))
  if (blocked.length > 0) {
    throw new Error(
      `Skill source "${source}" is not on the skill allowlist (${blocked.join(', ')}). ` +
        `Sync only fetches: ${allowlist.join(', ')}.`
    )
  }
  const slug = match[2] ?? match[1]
  return { slug, url: `https://github.com/${slug}.git`, named }
}
