import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runProcess } from './child-process/run-process'
import { resolveSkillSource } from './factory-skill-allowlist'
import { parseFactorySkillLock, sha256File, type FactorySkillLock } from './factory-skill-lock'
import { scanFactorySkills } from './factory-skill-safety'

export type SkillSourceFetcher = (params: {
  url: string
  commit: string
  dest: string
}) => Promise<void>

async function git(args: string[], cwd: string): Promise<void> {
  const result = await runProcess({ program: 'git', args, cwd, timeoutMs: 120_000 })
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`)
  }
}

export async function fetchSkillSource(params: {
  url: string
  commit: string
  dest: string
}): Promise<void> {
  mkdirSync(params.dest, { recursive: true })
  await git(['init', '-q'], params.dest)
  await git(['fetch', '--depth', '1', params.url, params.commit], params.dest)
  await git(['checkout', '--detach', 'FETCH_HEAD'], params.dest)
}

export async function readGitBranch(cwd: string): Promise<string | null> {
  // symbolic-ref works before the first commit; rev-parse does not.
  const symbolic = await runProcess({
    program: 'git',
    args: ['symbolic-ref', '--short', 'HEAD'],
    cwd,
    timeoutMs: 10_000
  })
  if (symbolic.code === 0 && symbolic.stdout.trim()) {
    return symbolic.stdout.trim()
  }
  const result = await runProcess({
    program: 'git',
    args: ['rev-parse', '--abbrev-ref', 'HEAD'],
    cwd,
    timeoutMs: 10_000
  })
  if (result.code !== 0) {
    return null
  }
  const name = result.stdout.trim()
  return name === 'HEAD' ? null : name
}

function skillSyncRefusal(branch: string | null, activeRun: boolean): string | null {
  if (branch?.startsWith('factory/')) {
    return 'Skills sync cannot run inside a factory worktree. Run it from the primary checkout.'
  }
  if (activeRun) {
    return 'Skills sync cannot run while a factory run is active for this repo.'
  }
  return null
}

function findSkillDir(sourceRoot: string, name: string): string | null {
  for (const dir of [
    join(sourceRoot, name),
    join(sourceRoot, 'skills', name),
    join(sourceRoot, '.agents', 'skills', name)
  ]) {
    if (existsSync(join(dir, 'SKILL.md'))) {
      return dir
    }
  }
  return null
}

function stageSkills(lock: FactorySkillLock, sources: Map<string, string>, staging: string): void {
  for (const [name, skill] of Object.entries(lock.skills)) {
    const sourceRoot = sources.get(skill.source)
    if (!sourceRoot) {
      throw new Error(
        `Skill "${name}" names source "${skill.source}", which is not in the lock sources.`
      )
    }
    const dir = findSkillDir(sourceRoot, name)
    if (!dir) {
      throw new Error(`Skill "${name}" was not in the fetched source.`)
    }
    for (const rel of Object.keys(skill.files)) {
      const from = join(dir, rel)
      if (!existsSync(from)) {
        throw new Error(`Skill "${name}" is missing ${rel} at the pinned commit.`)
      }
      const target = join(staging, name, rel)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(from, target)
    }
  }
}

function assertPinnedScripts(lock: FactorySkillLock, staging: string): void {
  for (const [rel, hash] of Object.entries(lock.allowedScripts)) {
    const full = join(staging, rel)
    if (!existsSync(full) || sha256File(full) !== hash) {
      throw new Error(`Refused to vendor ${rel}: its hash is not the lock's allowedScripts pin.`)
    }
  }
}

function writeLock(root: string, lock: FactorySkillLock, staging: string): void {
  for (const [name, skill] of Object.entries(lock.skills)) {
    for (const rel of Object.keys(skill.files)) {
      skill.files[rel] = sha256File(join(staging, name, rel))
    }
  }
  const body = {
    version: lock.version,
    ...(lock.note ? { note: lock.note } : {}),
    syncedAt: new Date().toISOString(),
    sources: lock.sources,
    skills: lock.skills,
    allowedScripts: lock.allowedScripts
  }
  mkdirSync(join(root, '.agents'), { recursive: true })
  writeFileSync(join(root, '.agents', 'skills.lock.json'), `${JSON.stringify(body, null, 2)}\n`)
}

/**
 * Fetches the pinned commits, copies only the selected skills, and leaves the tree uncommitted.
 * Refuses a factory worktree, an active run, a source off the allowlist, or a failed safety scan.
 */
export async function syncFactorySkills(
  root: string,
  options: { allowlist: readonly string[]; activeRun: boolean; fetch?: SkillSourceFetcher }
): Promise<{ skills: number; files: number }> {
  const branch = await readGitBranch(root)
  const refusal = skillSyncRefusal(branch, options.activeRun)
  if (refusal) {
    throw new Error(refusal)
  }
  const lockPath = join(root, '.agents', 'skills.lock.json')
  const lock = parseFactorySkillLock(readFileSync(lockPath, 'utf8'))
  const fetch = options.fetch ?? fetchSkillSource
  const fetched = new Map<string, string>()
  const scratch = mkdtempSync(join(tmpdir(), 'orca-skill-src-'))
  const staging = mkdtempSync(join(tmpdir(), 'orca-skill-stage-'))
  try {
    for (const source of lock.sources) {
      const resolved = resolveSkillSource(source.repo, options.allowlist)
      if (fetched.has(source.repo)) {
        continue
      }
      const dest = join(scratch, String(fetched.size))
      await fetch({ url: resolved.url, commit: source.commit, dest })
      fetched.set(source.repo, dest)
    }
    stageSkills(lock, fetched, staging)
    assertPinnedScripts(lock, staging)
    const problems = scanFactorySkills(staging, lock, options.allowlist)
    if (problems.length > 0) {
      throw new Error(
        `Refused to vendor skills:\n${problems.map((line) => `- ${line}`).join('\n')}`
      )
    }
    const skillsDir = join(root, '.agents', 'skills')
    rmSync(skillsDir, { recursive: true, force: true })
    mkdirSync(skillsDir, { recursive: true })
    cpSync(staging, skillsDir, { recursive: true })
    writeLock(root, lock, staging)
    const files = Object.values(lock.skills).reduce(
      (sum, skill) => sum + Object.keys(skill.files).length,
      0
    )
    return { skills: Object.keys(lock.skills).length, files }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(staging, { recursive: true, force: true })
  }
}
