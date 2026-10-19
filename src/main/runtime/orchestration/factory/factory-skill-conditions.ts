import type { FactoryReviewFinding } from '../../../../shared/factory-run-types'
import type { OrchestrationDb } from '../db'
import type { FactorySkillConditions } from './factory-skill-context'

const DEFAULT_RISK_GLOBS = [
  '**/*payment*',
  '**/*payment*/**',
  '**/*auth*',
  '**/*auth*/**',
  '**/*booking*',
  '**/*booking*/**',
  '**/*patient*',
  '**/*patient*/**',
  '**/*schema*',
  '**/*schema*/**'
]
const HIGH_RISK_LINES = 400
const FILE_IN_TEXT = /(?:^|[^\w./-])((?:[\w.-]+\/)*[\w.-]+\.(?:tsx?|jsx?))/g

export function findingsRepeat(
  previous: readonly FactoryReviewFinding[],
  current: readonly FactoryReviewFinding[]
): boolean {
  const prior = new Set(previous.map((finding) => `${finding.rule}\0${finding.file ?? ''}`))
  return current.some((finding) => prior.has(`${finding.rule}\0${finding.file ?? ''}`))
}

export function pathsInText(text: string): string[] {
  const paths: string[] = []
  for (const match of text.matchAll(FILE_IN_TEXT)) {
    const path = match[1]
    if (path && !paths.includes(path)) {
      paths.push(path)
    }
  }
  return paths
}

function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::GLOB::')
    .replace(/\*/g, '[^/]*')
    .replace(/::GLOB::/g, '.*')
  return new RegExp(`^${pattern}$`)
}

export function pathMatchesRisk(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path))
}

export function riskGlobs(db: OrchestrationDb, runId: string): string[] {
  const saved = db.listFactoryRunRiskPaths(runId).map((row) => row.path)
  return saved.length > 0 ? saved : DEFAULT_RISK_GLOBS
}

export function withPaths(
  base: FactorySkillConditions,
  paths: readonly string[],
  globs: readonly string[],
  changedLines: number
): FactorySkillConditions {
  return {
    ...base,
    ts: base.ts || paths.some((path) => /\.tsx?$/.test(path)),
    ui: base.ui || paths.some((path) => /^(src\/app|src\/components)(\/|$)/.test(path)),
    highRisk:
      base.highRisk ||
      changedLines > HIGH_RISK_LINES ||
      paths.some((path) => pathMatchesRisk(path, globs))
  }
}
