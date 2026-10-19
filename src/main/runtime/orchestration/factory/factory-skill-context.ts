import type { FactorySkillStage } from '../../../../shared/factory-config'

export type FactorySkillRole = 'intake' | 'coordinator' | 'build' | 'review' | 'fix' | 'writing'

export type FactorySkillConditions = {
  ts: boolean
  ui: boolean
  tests: boolean
  bug: boolean
  large: boolean
  highRisk: boolean
  fixRepeat: boolean
}

export const NO_SKILL_CONDITIONS: FactorySkillConditions = {
  ts: false,
  ui: false,
  tests: false,
  bug: false,
  large: false,
  highRisk: false,
  fixRepeat: false
}

export type FactorySkillDocument = {
  name: string
  stage: string
  path: string
  overlayPath: string | null
  text: string
  overlay: string | null
}

const PRECENDENCE = [
  '## Skill precedence',
  'When instructions conflict, the higher one wins:',
  '1. Factory hard rules: no push, human-only decisions, patient-data rule, quality gate.',
  '2. The approved brief (what the person asked for).',
  '3. Our repo docs: AGENTS.md, docs/code-conventions.md, docs/factory/patterns.md.',
  '4. Skills.',
  '',
  'Our app is mostly .jsx. TypeScript-specific skills apply only to .ts/.tsx files. Never convert files to TS unless the brief asks for it.'
].join('\n')

const BRIEF_FACTS = [
  '## Brief facts',
  'Set these on the brief JSON. Orca does not infer them from the words in the request.',
  '- triage: "bug" when this request fixes existing behavior that used to work. Omit it otherwise.',
  '- files: the paths you plan to change.',
  '- newModule: true when the brief adds a screen or a module.',
  'kind stays app_only, needs_backend, app_and_backend, needs_native, or not_feasible.'
].join('\n')

export function stagesForRole(
  role: FactorySkillRole,
  conditions: FactorySkillConditions
): FactorySkillStage[] {
  switch (role) {
    case 'intake':
      return ['intake']
    case 'coordinator':
      return conditions.large ? ['intake', 'plan', 'plan_when_large'] : ['intake', 'plan']
    case 'build': {
      const stages: FactorySkillStage[] = ['build']
      if (conditions.ui) {
        stages.push('build_ui')
      }
      if (conditions.ts) {
        stages.push('build_ts')
      }
      if (conditions.tests) {
        stages.push('build_tests')
      }
      if (conditions.bug) {
        stages.push('build_bug')
      }
      return stages
    }
    case 'review':
      return conditions.highRisk ? ['review', 'review_high_risk'] : ['review']
    case 'fix':
      return conditions.fixRepeat ? ['fix', 'fix_repeat'] : ['fix']
    case 'writing':
      return ['writing']
  }
}

/** Names in stage order, then the order the committed config listed them. */
export function skillsForRole(
  stages: Partial<Record<FactorySkillStage, readonly string[]>>,
  role: FactorySkillRole,
  conditions: FactorySkillConditions
): { stage: FactorySkillStage; skill: string }[] {
  const picked: { stage: FactorySkillStage; skill: string }[] = []
  for (const stage of stagesForRole(role, conditions)) {
    for (const skill of stages[stage] ?? []) {
      if (!picked.some((item) => item.skill === skill)) {
        picked.push({ stage, skill })
      }
    }
  }
  return picked
}

export function splitSkillFrontmatter(text: string): { description: string; body: string } {
  if (!text.startsWith('---\n')) {
    return { description: '', body: text.trim() }
  }
  const end = text.indexOf('\n---\n', 4)
  if (end === -1) {
    return { description: '', body: text.trim() }
  }
  return {
    description: descriptionFrom(text.slice(4, end)),
    body: text.slice(end + 5).trim()
  }
}

function descriptionFrom(frontmatter: string): string {
  const lines = frontmatter.split('\n')
  const index = lines.findIndex((line) => line.startsWith('description:'))
  if (index === -1) {
    return ''
  }
  const rest = lines[index].slice('description:'.length).trim()
  if (rest && rest !== '>' && rest !== '|' && rest !== '>-' && rest !== '|-') {
    return rest.replace(/^["']|["']$/g, '')
  }
  const more: string[] = []
  for (const line of lines.slice(index + 1)) {
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      break
    }
    more.push(line.trim())
  }
  return more.join(' ')
}

function skillBlock(skill: FactorySkillDocument, compact: boolean): string {
  const split = splitSkillFrontmatter(skill.text)
  if (compact) {
    return [
      `### ${skill.name}`,
      split.description,
      `Read \`${skill.path}\` before you act.`,
      skill.overlayPath ? `Overlay: \`${skill.overlayPath}\`` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
  return [
    `### ${skill.name}`,
    split.body,
    ...(skill.overlay ? ['', '#### Overlay', skill.overlay.trim()] : [])
  ].join('\n')
}

/**
 * Precedence, then `_all`, then each skill with its overlay.
 * Over the budget, each skill shrinks to its name, description, and path.
 */
export function renderSkillSection(params: {
  role: FactorySkillRole
  skills: readonly FactorySkillDocument[]
  allOverlay: string | null
  budget: number
}): string {
  if (params.skills.length === 0 && !params.allOverlay) {
    return ''
  }
  const header = [
    PRECENDENCE,
    ...(params.role === 'intake' || params.role === 'coordinator' ? ['', BRIEF_FACTS] : [])
  ].join('\n')
  const all = params.allOverlay?.trim() ? ['', '### All', params.allOverlay.trim()].join('\n') : ''
  const body = (compact: boolean): string =>
    [header, all, ...params.skills.map((skill) => `\n${skillBlock(skill, compact)}`)].join('\n')
  const full = body(false)
  return full.length <= params.budget ? full : body(true)
}
