import { execFileSync } from 'node:child_process'
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
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_FACTORY_SKILL_ALLOWLIST } from './factory-skill-allowlist'
import { inspectFactorySkills, parseFactorySkillLock } from './factory-skill-lock'
import { scanFactorySkills } from './factory-skill-safety'
import { syncFactorySkills, type SkillSourceFetcher } from './factory-skill-sync'

const PACK = join(process.cwd(), 'marham-skill-pack')
const roots: string[] = []

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'orca-skills-'))
  roots.push(root)
  return root
}

function gitInit(path: string, branch: string): void {
  execFileSync('git', ['init', '-q', '-b', branch, path])
}

function skillSource(): string {
  const source = scratch()
  cpSync(join(PACK, '.agents', 'skills'), source, { recursive: true })
  mkdirSync(join(source, 'swarm'))
  writeFileSync(join(source, 'swarm', 'SKILL.md'), '# swarm\n')
  return source
}

function targetWithLock(): string {
  const root = scratch()
  gitInit(root, 'main')
  mkdirSync(join(root, '.agents'))
  cpSync(join(PACK, '.agents', 'skills.lock.json'), join(root, '.agents', 'skills.lock.json'))
  return root
}

const copySource =
  (source: string): SkillSourceFetcher =>
  async ({ dest }) => {
    cpSync(source, dest, { recursive: true })
  }

describe('factory skill pack', () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports a clean pack as 76 files matching the lock', () => {
    const root = scratch()
    cpSync(PACK, root, { recursive: true })
    expect(inspectFactorySkills(root).text).toBe('OK, 76 files match the lock')
  })

  it('allows git-guardrails and refuses an injected git push elsewhere', () => {
    const lock = parseFactorySkillLock(
      readFileSync(join(PACK, '.agents', 'skills.lock.json'), 'utf8')
    )
    const clean = join(PACK, '.agents', 'skills')
    expect(scanFactorySkills(clean, lock, DEFAULT_FACTORY_SKILL_ALLOWLIST)).toEqual([])

    const poisoned = scratch()
    cpSync(clean, poisoned, { recursive: true })
    writeFileSync(join(poisoned, 'sharpen', 'SKILL.md'), '\ngit push origin main\n', { flag: 'a' })
    expect(scanFactorySkills(poisoned, lock, DEFAULT_FACTORY_SKILL_ALLOWLIST).join('\n')).toMatch(
      /sharpen\/SKILL.md contains git push/
    )
  })

  it('vendors only the selected skills and keeps the pinned hashes', async () => {
    const source = skillSource()
    const root = targetWithLock()
    const result = await syncFactorySkills(root, {
      allowlist: DEFAULT_FACTORY_SKILL_ALLOWLIST,
      activeRun: false,
      fetch: copySource(source)
    })
    expect(result.files).toBe(46)
    expect(existsSync(join(root, '.agents', 'skills', 'swarm'))).toBe(false)
    const vendored = readFileSync(
      join(root, '.agents', 'skills', 'git-guardrails-claude-code', 'SKILL.md'),
      'utf8'
    )
    expect(vendored).toContain('git push')
    const original = parseFactorySkillLock(
      readFileSync(join(PACK, '.agents', 'skills.lock.json'), 'utf8')
    )
    const updated = parseFactorySkillLock(
      readFileSync(join(root, '.agents', 'skills.lock.json'), 'utf8')
    )
    expect(updated.skills.sharpen?.files['SKILL.md']).toBe(
      original.skills.sharpen?.files['SKILL.md']
    )
    expect(updated.syncedAt).toBeTruthy()
  })

  it('refuses to vendor a non-allowlisted skill that contains git push', async () => {
    const source = skillSource()
    writeFileSync(join(source, 'sharpen', 'SKILL.md'), '\ngit push origin main\n', { flag: 'a' })
    const root = targetWithLock()
    await expect(
      syncFactorySkills(root, {
        allowlist: DEFAULT_FACTORY_SKILL_ALLOWLIST,
        activeRun: false,
        fetch: copySource(source)
      })
    ).rejects.toThrow(/sharpen\/SKILL.md contains git push/)
    expect(existsSync(join(root, '.agents', 'skills'))).toBe(false)
  })

  it('refuses a lock that names a repo outside the allowlist', async () => {
    const root = targetWithLock()
    const lock = parseFactorySkillLock(
      readFileSync(join(root, '.agents', 'skills.lock.json'), 'utf8')
    )
    lock.sources[0] = { repo: 'evil/skills', commit: 'a'.repeat(40), license: 'MIT' }
    writeFileSync(join(root, '.agents', 'skills.lock.json'), JSON.stringify(lock))
    let fetched = false
    await expect(
      syncFactorySkills(root, {
        allowlist: DEFAULT_FACTORY_SKILL_ALLOWLIST,
        activeRun: false,
        fetch: async () => {
          fetched = true
        }
      })
    ).rejects.toThrow(/not on the skill allowlist/)
    expect(fetched).toBe(false)
  })

  it('refuses to sync from a factory worktree or during an active run', async () => {
    const worktree = scratch()
    gitInit(worktree, 'factory/run_test')
    await expect(
      syncFactorySkills(worktree, { allowlist: DEFAULT_FACTORY_SKILL_ALLOWLIST, activeRun: false })
    ).rejects.toThrow(/factory worktree/)

    const root = scratch()
    gitInit(root, 'main')
    await expect(
      syncFactorySkills(root, { allowlist: DEFAULT_FACTORY_SKILL_ALLOWLIST, activeRun: true })
    ).rejects.toThrow(/factory run is active/)
  })
})
