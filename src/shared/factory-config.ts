import { parseDocument } from 'yaml'
import { parseOrcaYaml } from './orca-yaml'
import { MAX_ORCA_YAML_ALIAS_COUNT } from './orca-yaml-file-limit'

/**
 * The team's factory rules, committed to the repo's `orca.yaml`:
 *
 *   scripts:
 *     setup: npm install
 *     verify: npx tsc --noEmit
 *   factory:
 *     guidelines: [docs/code-conventions.md]
 *     maxWorkers: 3
 *     maxFixRounds: 3
 *
 * Read from the base branch, never a working copy, so changing them takes a reviewed PR.
 */
export type CommittedFactoryConfig = {
  verify: string
  setup: string | null
  guidelines: string[]
  maxWorkers: number | null
  maxFixRounds: number | null
}

const MAX_GUIDELINES = 20

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null
}

function guidelinePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  const paths: string[] = []
  for (const entry of value.slice(0, MAX_GUIDELINES)) {
    const path = typeof entry === 'string' ? entry.trim().replace(/\\/g, '/') : ''
    const segments = path.split('/')
    if (path && !path.startsWith('/') && !segments.includes('..') && !paths.includes(path)) {
      paths.push(path)
    }
  }
  return paths
}

/** Null unless the file has a `factory:` section and a verify command: both are opt-in signals. */
export function parseCommittedFactoryConfig(content: string): CommittedFactoryConfig | null {
  const hooks = parseOrcaYaml(content)
  const verify = hooks?.scripts.verify
  if (!verify) {
    return null
  }
  let factory: Record<string, unknown> | null = null
  try {
    const document = parseDocument(content, { logLevel: 'silent', uniqueKeys: true })
    factory = readRecord(
      readRecord(document.toJS({ maxAliasCount: MAX_ORCA_YAML_ALIAS_COUNT }))?.factory
    )
  } catch {
    return null
  }
  if (!factory) {
    return null
  }
  return {
    verify,
    setup: hooks.scripts.setup ?? null,
    guidelines: guidelinePaths(factory.guidelines),
    maxWorkers: positiveInt(factory.maxWorkers),
    maxFixRounds: positiveInt(factory.maxFixRounds)
  }
}
