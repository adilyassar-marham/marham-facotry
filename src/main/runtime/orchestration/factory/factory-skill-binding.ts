import {
  explainCommittedFactoryConfig,
  type CommittedFactorySkills,
  type FactorySkillStage
} from '../../../../shared/factory-config'
import type { Repo } from '../../../../shared/repo-types'
import type { OrchestrationDb } from '../db'
import type { FactoryRunSkillPackRow } from '../db/factory/factory-row-types'
import { pathsInText, riskGlobs, withPaths } from './factory-skill-conditions'
import {
  NO_SKILL_CONDITIONS,
  renderSkillSection,
  skillsForRole,
  type FactorySkillConditions,
  type FactorySkillDocument,
  type FactorySkillRole
} from './factory-skill-context'
import { runLocalGit, type FactoryGitRunner } from './factory-git'

export function skillProtectedRoots(db: OrchestrationDb, runId: string): string[] {
  const pack = db.getFactoryRunSkillPack(runId)
  return pack ? [pack.pack, pack.overlays] : []
}

async function show(git: FactoryGitRunner, repo: Repo, spec: string): Promise<string | null> {
  const result = await git(['show', spec], repo.path)
  return result.ok ? result.stdout : null
}

async function hasTestScript(git: FactoryGitRunner, repo: Repo, commit: string): Promise<boolean> {
  const text = await show(git, repo, `${commit}:package.json`)
  if (!text) {
    return false
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return false
    }
    const scripts = Object.getOwnPropertyDescriptor(parsed, 'scripts')?.value
    if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) {
      return false
    }
    const test = Object.getOwnPropertyDescriptor(scripts, 'test')?.value
    return typeof test === 'string' && test.trim().length > 0
  } catch {
    return false
  }
}

function approvedFacts(
  db: OrchestrationDb,
  runId: string
): { triage: 'bug' | null; files: string[]; newModule: boolean } | null {
  const request = db.getFactoryRequestByRun(runId)
  const brief = request ? db.latestFactoryBrief(request.id) : undefined
  if (!request || !brief || brief.status !== 'approved') {
    return null
  }
  const facts = db.getFactoryBriefFacts(request.id, brief.version)
  if (!facts) {
    return { triage: null, files: [], newModule: false }
  }
  let files: string[] = []
  try {
    const parsed: unknown = JSON.parse(facts.files_json)
    files = Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    files = []
  }
  return { triage: facts.triage, files, newModule: facts.new_module === 1 }
}

async function baseConditions(
  db: OrchestrationDb,
  repo: Repo,
  runId: string,
  commit: string,
  git: FactoryGitRunner
): Promise<FactorySkillConditions> {
  const facts = approvedFacts(db, runId)
  const files = facts?.files ?? []
  return withPaths(
    {
      ...NO_SKILL_CONDITIONS,
      tests: await hasTestScript(git, repo, commit),
      bug: facts?.triage === 'bug',
      large: files.length > 3 || facts?.newModule === true
    },
    files,
    riskGlobs(db, runId),
    0
  )
}

async function readSkills(
  git: FactoryGitRunner,
  repo: Repo,
  commit: string,
  skills: CommittedFactorySkills,
  picked: { stage: FactorySkillStage; skill: string }[]
): Promise<{ documents: FactorySkillDocument[]; allOverlay: string | null }> {
  const all = await show(git, repo, `${commit}:${skills.overlays}/_all.md`)
  const documents: FactorySkillDocument[] = []
  for (const item of picked) {
    const text = await show(git, repo, `${commit}:${skills.pack}/${item.skill}/SKILL.md`)
    if (!text) {
      continue
    }
    const overlayPath = `${skills.overlays}/${item.skill}.md`
    const overlay = await show(git, repo, `${commit}:${overlayPath}`)
    documents.push({
      name: item.skill,
      stage: item.stage,
      path: `${skills.pack}/${item.skill}/SKILL.md`,
      overlayPath: overlay ? overlayPath : null,
      text,
      overlay
    })
  }
  return { documents, allOverlay: all }
}

async function sectionFromCommit(
  git: FactoryGitRunner,
  repo: Repo,
  commit: string,
  role: FactorySkillRole,
  conditions: FactorySkillConditions
): Promise<string> {
  const yaml = await show(git, repo, `${commit}:orca.yaml`)
  const skills = yaml ? explainCommittedFactoryConfig(yaml).config?.skills : null
  if (!skills) {
    return ''
  }
  const picked = skillsForRole(skills.stages, role, conditions)
  const loaded = await readSkills(git, repo, commit, skills, picked)
  return renderSkillSection({
    role,
    skills: loaded.documents,
    allOverlay: loaded.allOverlay,
    budget: skills.budgetChars
  })
}

/** The coordinator starts before a run exists, so it reads the commit pinned on the request. */
export async function renderPinnedSkillSection(
  repo: Repo,
  commit: string,
  role: FactorySkillRole = 'coordinator',
  conditions: FactorySkillConditions = NO_SKILL_CONDITIONS,
  git: FactoryGitRunner = runLocalGit
): Promise<string> {
  return sectionFromCommit(git, repo, commit, role, conditions)
}

async function packSection(
  repo: Repo,
  pack: FactoryRunSkillPackRow,
  role: FactorySkillRole,
  conditions: FactorySkillConditions,
  git: FactoryGitRunner
): Promise<string> {
  return sectionFromCommit(git, repo, pack.base_commit, role, conditions)
}

export async function renderRunSkillSection(
  db: OrchestrationDb,
  repo: Repo,
  params: { runId: string; role: FactorySkillRole; conditions: FactorySkillConditions },
  git: FactoryGitRunner = runLocalGit
): Promise<string> {
  const pack = db.getFactoryRunSkillPack(params.runId)
  return pack ? packSection(repo, pack, params.role, params.conditions, git) : ''
}

export async function skillSectionForBuildTask(
  db: OrchestrationDb,
  repo: Repo,
  runId: string,
  spec: string,
  git: FactoryGitRunner = runLocalGit
): Promise<string> {
  const pack = db.getFactoryRunSkillPack(runId)
  if (!pack) {
    return ''
  }
  const base = await baseConditions(db, repo, runId, pack.base_commit, git)
  const conditions = withPaths(base, pathsInText(spec), riskGlobs(db, runId), 0)
  return packSection(repo, pack, 'build', conditions, git)
}

export async function skillSectionsForPlan(
  db: OrchestrationDb,
  repo: Repo,
  runId: string,
  tasks: readonly { key: string; spec: string }[],
  git: FactoryGitRunner = runLocalGit
): Promise<(task: { key: string; spec: string }) => string> {
  const sections = new Map<string, string>()
  for (const task of tasks) {
    sections.set(task.key, await skillSectionForBuildTask(db, repo, runId, task.spec, git))
  }
  return (task) => sections.get(task.key) ?? ''
}

export async function skillSectionForReview(
  db: OrchestrationDb,
  repo: Repo,
  params: { runId: string; changedFiles: readonly string[]; changedLines: number },
  git: FactoryGitRunner = runLocalGit
): Promise<string> {
  const pack = db.getFactoryRunSkillPack(params.runId)
  if (!pack) {
    return ''
  }
  const base = await baseConditions(db, repo, params.runId, pack.base_commit, git)
  const conditions = withPaths(
    base,
    params.changedFiles,
    riskGlobs(db, params.runId),
    params.changedLines
  )
  return packSection(repo, pack, 'review', conditions, git)
}

export async function skillSectionForFix(
  db: OrchestrationDb,
  repo: Repo,
  params: {
    runId: string
    changedFiles: readonly string[]
    changedLines: number
    fixRepeat: boolean
  },
  git: FactoryGitRunner = runLocalGit
): Promise<string> {
  const pack = db.getFactoryRunSkillPack(params.runId)
  if (!pack) {
    return ''
  }
  const base = await baseConditions(db, repo, params.runId, pack.base_commit, git)
  const conditions = withPaths(
    base,
    params.changedFiles,
    riskGlobs(db, params.runId),
    params.changedLines
  )
  return packSection(repo, pack, 'fix', { ...conditions, fixRepeat: params.fixRepeat }, git)
}
