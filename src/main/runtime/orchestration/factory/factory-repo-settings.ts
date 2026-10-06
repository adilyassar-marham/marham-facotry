import { readdirSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize, sep } from 'node:path'
import {
  FACTORY_DEFAULT_MAX_FIX_ROUNDS,
  FACTORY_DEFAULT_MAX_WORKERS,
  FACTORY_MAX_FIX_ROUNDS_CEILING,
  FACTORY_MAX_WORKERS_CEILING,
  type FactoryRepoSettings
} from '../../../../shared/factory-run-types'
import type { Repo } from '../../../../shared/repo-types'
import type { OrchestrationDb } from '../db'

const GUIDELINE_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  '.github/copilot-instructions.md',
  '.github/pull_request_template.md'
]
const GUIDELINE_DIRS = ['.cursor/rules']
const MAX_GUIDELINES = 20

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Common agent-rule files present in the primary checkout, used until a person saves a list. */
export function detectFactoryGuidelines(repoPath: string): string[] {
  const found = GUIDELINE_FILES.filter((file) => isFile(join(repoPath, file)))
  for (const dir of GUIDELINE_DIRS) {
    try {
      for (const name of readdirSync(join(repoPath, dir)).sort()) {
        if (/\.(md|mdc)$/i.test(name) && isFile(join(repoPath, dir, name))) {
          found.push(`${dir}/${name}`)
        }
      }
    } catch {
      // Directory absent: nothing to detect.
    }
  }
  return found.slice(0, MAX_GUIDELINES)
}

function clampInt(value: unknown, fallback: number, ceiling: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? Math.min(value, ceiling)
    : fallback
}

function parseGuidelines(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

export function resolveFactoryRepoSettings(
  db: OrchestrationDb,
  repo: Repo,
  options: { detect?: boolean } = {}
): FactoryRepoSettings {
  const saved = db.getFactoryRepoSettings(repo.id)
  if (!saved) {
    return {
      guidelines: options.detect === false ? [] : detectFactoryGuidelines(repo.path),
      maxWorkers: FACTORY_DEFAULT_MAX_WORKERS,
      maxFixRounds: FACTORY_DEFAULT_MAX_FIX_ROUNDS
    }
  }
  return {
    guidelines: parseGuidelines(saved.guidelines),
    maxWorkers: saved.max_workers,
    maxFixRounds: saved.max_fix_rounds
  }
}

/** Repo-relative and inside the repo: the reviewer is pointed at these paths verbatim. */
export function normalizeGuidelinePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, '/')
  if (!trimmed || isAbsolute(trimmed)) {
    return null
  }
  const normalized = normalize(trimmed).split(sep).join('/')
  return normalized.startsWith('../') || normalized === '..' ? null : normalized
}

export function saveFactoryRepoSettingsFromInput(
  db: OrchestrationDb,
  repo: Repo,
  input: { guidelines?: unknown; maxWorkers?: unknown; maxFixRounds?: unknown }
): FactoryRepoSettings {
  const rawGuidelines = Array.isArray(input.guidelines) ? input.guidelines : []
  const guidelines: string[] = []
  for (const entry of rawGuidelines) {
    const path = typeof entry === 'string' ? normalizeGuidelinePath(entry) : null
    if (typeof entry === 'string' && entry.trim() && !path) {
      throw new Error(`Guideline path "${entry}" must be relative to the repo root.`)
    }
    if (path && !guidelines.includes(path)) {
      guidelines.push(path)
    }
  }
  const settings: FactoryRepoSettings = {
    guidelines: guidelines.slice(0, MAX_GUIDELINES),
    maxWorkers: clampInt(
      input.maxWorkers,
      FACTORY_DEFAULT_MAX_WORKERS,
      FACTORY_MAX_WORKERS_CEILING
    ),
    maxFixRounds: clampInt(
      input.maxFixRounds,
      FACTORY_DEFAULT_MAX_FIX_ROUNDS,
      FACTORY_MAX_FIX_ROUNDS_CEILING
    )
  }
  db.saveFactoryRepoSettings({ repoId: repo.id, ...settings })
  return settings
}

/** Absolute paths in the primary checkout — never the branch under review, which could edit them. */
export function resolveGuidelineFiles(
  repo: Repo,
  guidelines: readonly string[]
): { present: string[]; missing: string[] } {
  const present: string[] = []
  const missing: string[] = []
  for (const path of guidelines) {
    const absolute = join(repo.path, path)
    if (isFile(absolute)) {
      present.push(absolute)
    } else {
      missing.push(path)
    }
  }
  return { present, missing }
}
