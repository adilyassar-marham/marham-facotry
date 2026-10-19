import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SKILL_NAME = /^[a-z0-9-]+$/
const REL_FILE = /^[A-Za-z0-9][A-Za-z0-9./_-]*$/
const SHA256 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/

export type FactorySkillLock = {
  version: number
  note?: string
  syncedAt?: string
  sources: { repo: string; commit: string; license: string }[]
  skills: Record<string, { source: string; files: Record<string, string> }>
  allowedScripts: Record<string, string>
}

export type FactorySkillStatus = {
  ok: boolean
  matched: number
  text: string
  problems: string[]
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function field(obj: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(obj, key)?.value
}

function stringMap(value: unknown, pattern: RegExp, label: string): Record<string, string> {
  const obj = record(value)
  if (!obj) {
    throw new Error(`${label} must be an object.`)
  }
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(obj)) {
    if (!pattern.test(key) || typeof raw !== 'string' || !SHA256.test(raw)) {
      throw new Error(`${label} entry "${key}" is not a relative path with a sha256.`)
    }
    if (key.split('/').includes('..')) {
      throw new Error(`${label} entry "${key}" leaves its directory.`)
    }
    out[key] = raw
  }
  return out
}

export function parseFactorySkillLock(raw: string): FactorySkillLock {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('skills.lock.json is not valid JSON.')
  }
  const root = record(parsed)
  if (!root || field(root, 'version') !== 1) {
    throw new Error('skills.lock.json must be version 1.')
  }
  const sourceList = field(root, 'sources')
  if (!Array.isArray(sourceList)) {
    throw new Error('skills.lock.json needs a sources array.')
  }
  const sources: FactorySkillLock['sources'] = []
  for (const entry of sourceList) {
    const source = record(entry)
    const repo = source ? field(source, 'repo') : undefined
    const commit = source ? field(source, 'commit') : undefined
    const license = source ? field(source, 'license') : undefined
    if (typeof repo !== 'string' || typeof commit !== 'string' || !COMMIT.test(commit)) {
      throw new Error('Each skill source needs a repo and a 40-character commit.')
    }
    sources.push({ repo, commit, license: typeof license === 'string' ? license : '' })
  }
  const skillsRaw = record(field(root, 'skills'))
  if (!skillsRaw) {
    throw new Error('skills.lock.json needs a skills object.')
  }
  const skills: FactorySkillLock['skills'] = {}
  for (const [name, value] of Object.entries(skillsRaw)) {
    if (!SKILL_NAME.test(name)) {
      throw new Error(`Skill name "${name}" must match [a-z0-9-]+.`)
    }
    const skill = record(value)
    const source = skill ? field(skill, 'source') : undefined
    if (!skill || typeof source !== 'string') {
      throw new Error(`Skill "${name}" needs a source.`)
    }
    skills[name] = { source, files: stringMap(field(skill, 'files'), REL_FILE, name) }
  }
  const note = field(root, 'note')
  const syncedAt = field(root, 'syncedAt')
  return {
    version: 1,
    ...(typeof note === 'string' ? { note } : {}),
    ...(typeof syncedAt === 'string' ? { syncedAt } : {}),
    sources,
    skills,
    allowedScripts: stringMap(field(root, 'allowedScripts') ?? {}, REL_FILE, 'allowedScripts')
  }
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...walkFiles(path))
    } else if (entry.isFile()) {
      found.push(path)
    }
  }
  return found
}

function posix(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

const REQUIRED_COMPANIONS = [
  'AGENTS.md',
  'docs/code-conventions.md',
  '.agents/skills-overlays/_all.md'
]

/** Hashes `.agents/skills` against the lock and counts the rest of a full pack. */
export function inspectFactorySkills(root: string): FactorySkillStatus {
  const lockPath = join(root, '.agents', 'skills.lock.json')
  if (!existsSync(lockPath)) {
    return {
      ok: false,
      matched: 0,
      text: 'No .agents/skills.lock.json.',
      problems: ['missing lock']
    }
  }
  let lock: FactorySkillLock
  try {
    lock = parseFactorySkillLock(readFileSync(lockPath, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, matched: 0, text: message, problems: [message] }
  }
  const problems: string[] = []
  const locked = new Set<string>()
  let matched = 0
  for (const [name, skill] of Object.entries(lock.skills)) {
    for (const [rel, hash] of Object.entries(skill.files)) {
      const path = `.agents/skills/${name}/${rel}`
      locked.add(path)
      const full = join(root, '.agents', 'skills', name, rel)
      if (!existsSync(full) || !statSync(full).isFile()) {
        problems.push(`${path} is missing`)
        continue
      }
      const actual = sha256File(full)
      if (actual !== hash) {
        problems.push(`${path} hash mismatch`)
        continue
      }
      matched += 1
    }
  }
  for (const [rel, hash] of Object.entries(lock.allowedScripts)) {
    const full = join(root, '.agents', 'skills', rel)
    if (!existsSync(full) || sha256File(full) !== hash) {
      problems.push(`.agents/skills/${rel} is not the allowlisted script`)
    }
  }
  const skillsDir = join(root, '.agents', 'skills')
  for (const full of walkFiles(skillsDir)) {
    const path = posix(root, full)
    if (!locked.has(path)) {
      problems.push(`${path} is not in the lock`)
    }
  }
  for (const rel of REQUIRED_COMPANIONS) {
    if (!existsSync(join(root, rel))) {
      problems.push(`${rel} is missing`)
    }
  }
  for (const dir of ['.agents/skills-overlays', '.agents/LICENSES']) {
    matched += walkFiles(join(root, dir)).length
  }
  for (const rel of ['.agents/skills.lock.json', 'AGENTS.md', 'docs/code-conventions.md']) {
    if (existsSync(join(root, rel))) {
      matched += 1
    }
  }
  const text =
    problems.length === 0
      ? `OK, ${matched} files match the lock`
      : `Drift (${problems.length}):\n${problems.map((line) => `- ${line}`).join('\n')}`
  return { ok: problems.length === 0, matched, text, problems }
}
