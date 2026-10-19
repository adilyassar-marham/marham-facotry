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
export const FACTORY_SKILL_STAGES = [
  'intake',
  'plan',
  'plan_when_large',
  'build',
  'build_ui',
  'build_ts',
  'build_tests',
  'build_bug',
  'review',
  'review_high_risk',
  'fix',
  'fix_repeat',
  'writing'
] as const

export type FactorySkillStage = (typeof FACTORY_SKILL_STAGES)[number]

export type CommittedFactorySkills = {
  pack: string
  overlays: string
  budgetChars: number
  stages: Partial<Record<FactorySkillStage, string[]>>
}

export type CommittedFactoryConfig = {
  verify: string
  setup: string | null
  guidelines: string[]
  maxWorkers: number | null
  maxFixRounds: number | null
  skills: CommittedFactorySkills | null
  highRiskPaths: string[]
}

export type FactoryConfigExplanation = {
  config: CommittedFactoryConfig | null
  /** Set when `factory.skills` or `factory.highRiskPaths` is present but invalid. */
  error: string | null
}

const MAX_GUIDELINES = 20
const MAX_SKILLS = 40
const MAX_RISK_PATHS = 40
const DEFAULT_SKILL_BUDGET = 60_000
const SKILL_NAME = /^[a-z0-9-]+$/

function isFactorySkillStage(key: string): key is FactorySkillStage {
  return FACTORY_SKILL_STAGES.some((stage) => stage === key)
}

function relativePath(entry: unknown): string | null {
  const path = typeof entry === 'string' ? entry.trim().replace(/\\/g, '/') : ''
  const segments = path.split('/')
  if (!path || path.startsWith('/') || segments.includes('..')) {
    return null
  }
  return path
}

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

function strictPaths(value: unknown, label: string): { paths: string[]; error: string | null } {
  if (value === undefined) {
    return { paths: [], error: null }
  }
  if (!Array.isArray(value)) {
    return { paths: [], error: `${label} must be a list of relative paths.` }
  }
  if (value.length > MAX_RISK_PATHS) {
    return { paths: [], error: `${label} lists more than ${MAX_RISK_PATHS} paths.` }
  }
  const paths: string[] = []
  for (const entry of value) {
    const path = relativePath(entry)
    if (!path) {
      const shown = typeof entry === 'string' ? entry : ''
      return { paths: [], error: `${label} entry "${shown}" must be a relative path.` }
    }
    if (!paths.includes(path)) {
      paths.push(path)
    }
  }
  return { paths, error: null }
}

function parseSkillStages(value: unknown): {
  stages: Partial<Record<FactorySkillStage, string[]>>
  error: string | null
} {
  const stagesRecord = readRecord(value)
  if (!stagesRecord) {
    return { stages: {}, error: 'factory.skills.stages must be a mapping of stage to skill names.' }
  }
  const stages: Partial<Record<FactorySkillStage, string[]>> = {}
  let count = 0
  for (const key of Object.keys(stagesRecord)) {
    if (!isFactorySkillStage(key)) {
      return { stages: {}, error: `Unknown factory skill stage "${key}".` }
    }
    const list = stagesRecord[key]
    if (
      !Array.isArray(list) ||
      !list.every((item) => typeof item === 'string' && SKILL_NAME.test(item))
    ) {
      return {
        stages: {},
        error: `factory.skills.stages.${key} must be a list of skill names.`
      }
    }
    count += list.length
    stages[key] = list
  }
  if (count > MAX_SKILLS) {
    return { stages: {}, error: `factory.skills names more than ${MAX_SKILLS} skills.` }
  }
  return { stages, error: null }
}

function parseSkills(value: unknown): {
  skills: CommittedFactorySkills | null
  error: string | null
} {
  if (value === undefined) {
    return { skills: null, error: null }
  }
  const record = readRecord(value)
  if (!record) {
    return { skills: null, error: 'factory.skills must be a mapping.' }
  }
  const pack = relativePath(record.pack)
  const overlays = relativePath(record.overlays)
  if (!pack || !overlays) {
    return {
      skills: null,
      error: 'factory.skills needs relative pack and overlays paths.'
    }
  }
  const budget =
    record.budgetChars === undefined ? DEFAULT_SKILL_BUDGET : positiveInt(record.budgetChars)
  if (!budget) {
    return { skills: null, error: 'factory.skills.budgetChars must be a positive integer.' }
  }
  const parsed = parseSkillStages(record.stages)
  if (parsed.error) {
    return { skills: null, error: parsed.error }
  }
  return { skills: { pack, overlays, budgetChars: budget, stages: parsed.stages }, error: null }
}

/**
 * Null config unless the file has a `factory:` section and a verify command.
 * `error` is set when skills or high-risk paths are present but invalid, so baseline can say why.
 */
export function explainCommittedFactoryConfig(content: string): FactoryConfigExplanation {
  const hooks = parseOrcaYaml(content)
  const verify = hooks?.scripts.verify
  if (!verify) {
    return { config: null, error: null }
  }
  let factory: Record<string, unknown> | null = null
  try {
    const document = parseDocument(content, { logLevel: 'silent', uniqueKeys: true })
    factory = readRecord(
      readRecord(document.toJS({ maxAliasCount: MAX_ORCA_YAML_ALIAS_COUNT }))?.factory
    )
  } catch {
    return { config: null, error: null }
  }
  if (!factory) {
    return { config: null, error: null }
  }
  const skills = parseSkills(factory.skills)
  if (skills.error) {
    return { config: null, error: skills.error }
  }
  const highRiskPaths = strictPaths(factory.highRiskPaths, 'factory.highRiskPaths')
  if (highRiskPaths.error) {
    return { config: null, error: highRiskPaths.error }
  }
  return {
    config: {
      verify,
      setup: hooks.scripts.setup ?? null,
      guidelines: guidelinePaths(factory.guidelines),
      maxWorkers: positiveInt(factory.maxWorkers),
      maxFixRounds: positiveInt(factory.maxFixRounds),
      skills: skills.skills,
      highRiskPaths: highRiskPaths.paths
    },
    error: null
  }
}

/** Null unless the file has a `factory:` section and a verify command: both are opt-in signals. */
export function parseCommittedFactoryConfig(content: string): CommittedFactoryConfig | null {
  return explainCommittedFactoryConfig(content).config
}
