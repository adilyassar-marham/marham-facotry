import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FactorySkillStage } from '../../../../shared/factory-config'
import { OrchestrationDb } from '../db'
import { runFactoryBaseline } from './factory-baseline'
import { createFactoryHost, createFactoryRepo, git } from './factory-flow-test-fixture'
import { enableManagedFactoryGate } from './factory-gate-approval'
import { INTAKE_PROMPT } from './factory-intake-prompt'
import { buildFactoryCoordinatorPrompt } from './factory-request'
import {
  NO_SKILL_CONDITIONS,
  renderSkillSection,
  skillsForRole,
  type FactorySkillConditions,
  type FactorySkillDocument,
  type FactorySkillRole
} from './factory-skill-context'
import { renderPinnedSkillSection, skillSectionForBuildTask } from './factory-skill-binding'
import { findingsRepeat, pathMatchesRisk } from './factory-skill-conditions'
import type { FactoryScriptRunner } from './factory-verify'

const STAGES: Partial<Record<FactorySkillStage, string[]>> = {
  intake: ['sharpen'],
  plan: ['to-tickets'],
  plan_when_large: ['architect'],
  build: ['principle-laziness-protocol'],
  build_ui: ['principle-experience-first'],
  build_ts: ['typescript-best-practices'],
  build_tests: ['tdd'],
  build_bug: ['diagnosing-bugs'],
  review: ['code-review'],
  review_high_risk: ['interrogate'],
  fix: ['diagnosing-bugs'],
  fix_repeat: ['principle-attack-the-premise'],
  writing: ['unslop']
}

function conditions(overrides: Partial<FactorySkillConditions> = {}): FactorySkillConditions {
  return { ...NO_SKILL_CONDITIONS, ...overrides }
}

function names(role: FactorySkillRole, overrides: Partial<FactorySkillConditions> = {}): string[] {
  return skillsForRole(STAGES, role, conditions(overrides)).map((item) => item.skill)
}

function document(name: string, body: string, overlay: string | null = null): FactorySkillDocument {
  return {
    name,
    stage: 'build',
    path: `.agents/skills/${name}/SKILL.md`,
    overlayPath: overlay ? `.agents/skills-overlays/${name}.md` : null,
    text: `---\nname: ${name}\ndescription: ${name} helps.\n---\n${body}\n`,
    overlay
  }
}

describe('factory skill prompts', () => {
  it('picks skills from the role and the facts, not from words in the request', () => {
    expect(names('intake')).toEqual(['sharpen'])
    expect(names('coordinator')).toEqual(['sharpen', 'to-tickets'])
    expect(names('coordinator', { large: true })).toEqual(['sharpen', 'to-tickets', 'architect'])
    expect(names('build')).toEqual(['principle-laziness-protocol'])
    expect(names('build', { ui: true, ts: true, tests: true, bug: true })).toEqual([
      'principle-laziness-protocol',
      'principle-experience-first',
      'typescript-best-practices',
      'tdd',
      'diagnosing-bugs'
    ])
    expect(names('review')).toEqual(['code-review'])
    expect(names('review', { highRisk: true })).toEqual(['code-review', 'interrogate'])
    expect(names('fix')).toEqual(['diagnosing-bugs'])
    expect(names('fix', { fixRepeat: true })).toEqual([
      'diagnosing-bugs',
      'principle-attack-the-premise'
    ])
    expect(names('writing')).toEqual(['unslop'])
    expect(names('build', { bug: false })).not.toContain('diagnosing-bugs')
  })

  it('renders precedence, strips frontmatter, and follows each skill with its overlay', () => {
    const section = renderSkillSection({
      role: 'build',
      skills: [document('sharpen', 'Ask one question.', 'Offer choices.')],
      allOverlay: 'Never push.',
      budget: 60_000
    })
    expect(section).toContain('1. Factory hard rules')
    expect(section).toContain('Never push.')
    expect(section).toContain('Ask one question.')
    expect(section).toContain('Offer choices.')
    expect(section).not.toContain('name: sharpen')
    expect(section.indexOf('Ask one question.')).toBeLessThan(section.indexOf('Offer choices.'))
    expect(section).not.toContain('triage')
  })

  it('tells intake to set bug and file facts instead of leaving them to be guessed', () => {
    const section = renderSkillSection({
      role: 'intake',
      skills: [document('sharpen', 'Ask one question.')],
      allOverlay: null,
      budget: 60_000
    })
    expect(section).toContain('triage: "bug"')
    expect(section).toContain('does not infer')
  })

  it('falls back to the name, description, and path when the section is over budget', () => {
    const section = renderSkillSection({
      role: 'writing',
      skills: [document('unslop', 'A'.repeat(500))],
      allOverlay: null,
      budget: 400
    })
    expect(section).toContain('unslop helps.')
    expect(section).toContain('Read `.agents/skills/unslop/SKILL.md`')
    expect(section).not.toContain('A'.repeat(500))
  })

  it('treats payment paths and a repeated finding as facts', () => {
    expect(pathMatchesRisk('src/payments/fee.tsx', ['**/*payment*/**'])).toBe(true)
    expect(pathMatchesRisk('src/app/fee.tsx', ['**/*payment*'])).toBe(false)
    expect(
      findingsRepeat(
        [{ rule: 'Minimal', file: 'src/app/fee.tsx', problem: 'extra' }],
        [{ rule: 'Minimal', file: 'src/app/fee.tsx', problem: 'still extra' }]
      )
    ).toBe(true)
    expect(
      findingsRepeat(
        [{ rule: 'Minimal', file: 'src/app/fee.tsx', problem: 'extra' }],
        [{ rule: 'Minimal', file: 'src/app/other.tsx', problem: 'extra' }]
      )
    ).toBe(false)
  })

  it('appends the skill section to the coordinator prompt without editing the intake text', () => {
    const prompt = buildFactoryCoordinatorPrompt({
      requestId: 'freq_1',
      title: 'Save doctors',
      description: 'A heart on each doctor.',
      agent: 'cursor',
      cli: 'orca-dev',
      skillsSection: '## Skill precedence\n4. Skills.'
    })
    expect(prompt).toContain(INTAKE_PROMPT.replaceAll('ORCA', 'orca-dev').trim())
    expect(prompt.indexOf('# Intake')).toBeLessThan(prompt.indexOf('## Skill precedence'))
  })
})

const FIRST = '# first skill\n'
const SECOND = '# second skill\n'
const runner: FactoryScriptRunner = async () => ({ success: true, output: 'ok', exitCode: 0 })

function skillYaml(): string {
  return [
    'scripts:',
    '  verify: echo ok',
    'factory:',
    '  skills:',
    '    pack: .agents/skills',
    '    overlays: .agents/skills-overlays',
    '    budgetChars: 60000',
    '    stages:',
    '      intake: [sharpen]',
    '      plan: [sharpen]',
    '      build: [sharpen]',
    '      build_ts: [typescript-best-practices]',
    ''
  ].join('\n')
}

function writeSkill(repoPath: string, name: string, body: string): void {
  const dir = join(repoPath, '.agents', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
}

describe('pinned skill text', () => {
  let root = ''

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('injects the commit pinned for the request, not a later edit of the skill', async () => {
    const created = createFactoryRepo()
    root = created.root
    const { repo } = created
    writeFileSync(join(repo.path, 'orca.yaml'), skillYaml())
    writeSkill(repo.path, 'sharpen', FIRST)
    writeSkill(repo.path, 'typescript-best-practices', 'ts rules\n')
    mkdirSync(join(repo.path, '.agents', 'skills-overlays'), { recursive: true })
    writeFileSync(join(repo.path, '.agents', 'skills-overlays', '_all.md'), 'Never push.\n')
    git(repo.path, 'add', 'orca.yaml', '.agents')
    git(repo.path, 'commit', '-qm', 'skills')
    git(repo.path, 'push', '-q', join(root, 'remote.git'), 'main')
    git(repo.path, 'fetch', '-q', 'origin')
    const pinned = git(repo.path, 'rev-parse', 'HEAD')

    writeSkill(repo.path, 'sharpen', SECOND)
    const section = await renderPinnedSkillSection(repo, pinned, 'coordinator')
    expect(section).toContain(FIRST.trim())
    expect(section).not.toContain(SECOND.trim())
    expect(section).toContain('Never push.')
    expect(section).toContain('triage: "bug"')

    const db = new OrchestrationDb(':memory:')
    const host = createFactoryHost(root, repo)
    try {
      await enableManagedFactoryGate(db, repo)
      const request = db.createFactoryRequest({
        repoId: repo.id,
        title: 'Pin',
        description: 'Keep the first skill.',
        agent: 'cursor'
      })
      db.recordFactoryRequestBase({
        request_id: request.id,
        base_ref: 'origin/main',
        base_commit: pinned
      })
      await runFactoryBaseline(
        db,
        host,
        {
          runId: 'run_legacy_local',
          worktreeSelector: `id:${repo.id}::${repo.path}`,
          requestId: request.id
        },
        { runner }
      )
      const worker = await skillSectionForBuildTask(
        db,
        repo,
        'run_legacy_local',
        'Edit src/app/fee.tsx'
      )
      expect(worker).toContain(FIRST.trim())
      expect(worker).toContain('ts rules')
      expect(worker).not.toContain(SECOND.trim())
    } finally {
      db.close()
    }
  })
})
