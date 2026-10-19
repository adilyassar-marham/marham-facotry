import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import {
  explainCommittedFactoryConfig,
  FACTORY_SKILL_STAGES,
  type CommittedFactorySkills
} from '../../../../shared/factory-config'
import { parseFactorySkillLock, type FactorySkillLock } from '../../../../shared/factory-skill-lock'
import type { FactorySkillCatalog } from '../../../../shared/factory-types'
import type { Repo } from '../../../../shared/repo-types'
import { getDefaultBaseRef } from '../../../source-control/hosted-review-creation-git-state'
import type { OrchestrationDb } from '../db'
import type { FactoryRunSkillRow } from '../db/factory/factory-row-types'
import { OrchestrationError } from '../orchestration-error'
import { runLocalGit, type FactoryGitRunner } from './factory-git'
import { readCommittedFactoryRules } from './factory-managed-config'

function lockPathForPack(pack: string): string {
  const slash = pack.lastIndexOf('/')
  const parent = slash === -1 ? '' : pack.slice(0, slash)
  return parent ? `${parent}/skills.lock.json` : 'skills.lock.json'
}

function readLock(text: string): FactorySkillLock | null {
  try {
    return parseFactorySkillLock(text)
  } catch {
    return null
  }
}

function pinFor(
  lock: FactorySkillLock | null,
  skill: string,
  baseCommit: string
): { source: string; pinned: string } {
  const entry = lock?.skills[skill]
  if (!entry) {
    return { source: '', pinned: baseCommit }
  }
  const source = lock?.sources.find((item) => item.repo === entry.source)
  return { source: entry.source, pinned: source?.commit || baseCommit }
}

/** Records the base commit a request's skills are read from. Git failures leave the request unpinched. */
export async function pinFactoryRequestBase(
  db: OrchestrationDb,
  requestId: string,
  repo: Repo
): Promise<void> {
  try {
    const baseRef =
      (await getDefaultBaseRef(repo.path, LOCAL_EXECUTION_HOST_ID).catch(() => null)) ??
      'origin/HEAD'
    const commit = await runLocalGit(['rev-parse', '--verify', `${baseRef}^{commit}`], repo.path)
    if (!commit.ok) {
      return
    }
    db.recordFactoryRequestBase({
      request_id: requestId,
      base_ref: baseRef,
      base_commit: commit.stdout.trim()
    })
  } catch {
    // Git failures leave the request unpinned; baseline then reads the base branch itself.
  }
}

async function skillRows(
  git: FactoryGitRunner,
  repo: Repo,
  commit: string,
  skills: CommittedFactorySkills,
  lock: FactorySkillLock | null
): Promise<FactoryRunSkillRow[]> {
  const hashes = new Map<string, string>()
  const names = new Set<string>()
  for (const stage of FACTORY_SKILL_STAGES) {
    for (const skill of skills.stages[stage] ?? []) {
      names.add(skill)
    }
  }
  for (const skill of names) {
    const shown = await git(['show', `${commit}:${skills.pack}/${skill}/SKILL.md`], repo.path)
    if (!shown.ok) {
      throw new OrchestrationError(
        'factory_rules_invalid',
        `Skill ${skill} is missing from ${skills.pack} at ${commit.slice(0, 12)}.`
      )
    }
    hashes.set(skill, createHash('sha256').update(shown.stdout).digest('hex'))
  }
  const rows: FactoryRunSkillRow[] = []
  for (const stage of FACTORY_SKILL_STAGES) {
    for (const skill of skills.stages[stage] ?? []) {
      const pin = pinFor(lock, skill, commit)
      const sha256 = hashes.get(skill)
      if (!sha256 || rows.some((row) => row.stage === stage && row.skill === skill)) {
        continue
      }
      rows.push({
        run_id: '',
        stage,
        skill,
        sha256,
        source: pin.source,
        pinned_commit: pin.pinned
      })
    }
  }
  return rows
}

/** Copies the skill lists from one commit onto the run. Invalid skills fail the baseline. */
export async function snapshotFactoryRunSkills(
  db: OrchestrationDb,
  params: { runId: string; repo: Repo; commit: string },
  git: FactoryGitRunner = runLocalGit
): Promise<void> {
  if (db.getFactoryRunSkillPack(params.runId)) {
    return
  }
  const file = await git(['show', `${params.commit}:orca.yaml`], params.repo.path)
  if (!file.ok) {
    db.replaceFactorySkillSnapshot({ runId: params.runId, pack: null, skills: [], paths: [] })
    return
  }
  const explained = explainCommittedFactoryConfig(file.stdout)
  if (explained.error) {
    throw new OrchestrationError('factory_rules_invalid', explained.error)
  }
  const skills = explained.config?.skills ?? null
  const paths = explained.config?.highRiskPaths ?? []
  if (!skills) {
    db.replaceFactorySkillSnapshot({ runId: params.runId, pack: null, skills: [], paths })
    return
  }
  const lockFile = await git(
    ['show', `${params.commit}:${lockPathForPack(skills.pack)}`],
    params.repo.path
  )
  const lock = lockFile.ok ? readLock(lockFile.stdout) : null
  const rows = await skillRows(git, params.repo, params.commit, skills, lock)
  db.replaceFactorySkillSnapshot({
    runId: params.runId,
    pack: {
      run_id: params.runId,
      base_commit: params.commit,
      pack: skills.pack,
      overlays: skills.overlays,
      budget_chars: skills.budgetChars
    },
    skills: rows.map((row) => ({ ...row, run_id: params.runId })),
    paths
  })
}

/** What Settings shows: the base branch's skill list, not a working-tree edit. */
export async function readFactorySkillCatalog(repo: Repo): Promise<FactorySkillCatalog | null> {
  let rules: Awaited<ReturnType<typeof readCommittedFactoryRules>>
  try {
    rules = await readCommittedFactoryRules(repo, { fetch: false })
  } catch {
    return null
  }
  const skills = rules?.config.skills
  if (!rules || !skills) {
    return null
  }
  const lockFile = await runLocalGit(
    ['show', `${rules.commit}:${lockPathForPack(skills.pack)}`],
    repo.path
  )
  const lock = lockFile.ok ? readLock(lockFile.stdout) : null
  const entries: FactorySkillCatalog['entries'] = []
  for (const stage of FACTORY_SKILL_STAGES) {
    for (const skill of skills.stages[stage] ?? []) {
      const pin = pinFor(lock, skill, rules.commit)
      entries.push({ stage, skill, source: pin.source, pinnedCommit: pin.pinned })
    }
  }
  return { entries, syncedAt: lock?.syncedAt ?? null }
}

/** Copies the run's pinned skill files into a private folder. Null when the run has no pack. */
export async function extractRunSkills(
  db: OrchestrationDb,
  params: { runId: string; repo: Repo },
  git: FactoryGitRunner = runLocalGit
): Promise<string | null> {
  const pack = db.getFactoryRunSkillPack(params.runId)
  if (!pack) {
    return null
  }
  const dir = await mkdtemp(join(tmpdir(), 'orca-factory-skills-'))
  for (const root of [pack.pack, pack.overlays]) {
    const listed = await git(
      ['ls-tree', '-r', '--name-only', pack.base_commit, '--', root],
      params.repo.path
    )
    if (!listed.ok) {
      continue
    }
    for (const path of listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)) {
      const shown = await git(['show', `${pack.base_commit}:${path}`], params.repo.path)
      if (!shown.ok) {
        continue
      }
      const target = join(dir, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, shown.stdout, 'utf8')
    }
  }
  return dir
}
