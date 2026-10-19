import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { OrchestrationDb } from '../db'
import { runFactoryBaseline } from './factory-baseline'
import { createFactoryHost, createFactoryRepo, git } from './factory-flow-test-fixture'
import { enableManagedFactoryGate } from './factory-gate-approval'
import { extractRunSkills, pinFactoryRequestBase } from './factory-skill-snapshot'
import type { FactoryScriptRunner } from './factory-verify'

const FIRST = '# first skill\n'
const SECOND = '# second skill\n'

function skillYaml(verify: string): string {
  return [
    'scripts:',
    '  setup: npm ci',
    `  verify: ${verify}`,
    'factory:',
    '  skills:',
    '    pack: .agents/skills',
    '    overlays: .agents/skills-overlays',
    '    stages:',
    '      build: [sharpen]',
    '  highRiskPaths:',
    '    - src/payments/**',
    ''
  ].join('\n')
}

let db: OrchestrationDb
let root: string
let repo: Repo
let host: ReturnType<typeof createFactoryHost>
const runner: FactoryScriptRunner = async () => ({ success: true, output: 'ok', exitCode: 0 })

function commitSkill(yaml: string, body: string): void {
  writeFileSync(join(repo.path, 'orca.yaml'), yaml)
  const dir = join(repo.path, '.agents', 'skills', 'sharpen')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), body)
  mkdirSync(join(repo.path, '.agents', 'skills-overlays'), { recursive: true })
  writeFileSync(join(repo.path, '.agents', 'skills-overlays', '_all.md'), '# all\n')
  git(repo.path, 'add', 'orca.yaml', '.agents')
  git(repo.path, 'commit', '-qm', 'skills')
  git(repo.path, 'push', '-q', join(root, 'remote.git'), 'main')
  git(repo.path, 'fetch', '-q', 'origin')
}

describe('factory skill snapshot', () => {
  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
    ;({ root, repo } = createFactoryRepo())
    host = createFactoryHost(root, repo)
  })
  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('keeps the skills from the commit pinned when the request was created', async () => {
    commitSkill(skillYaml('team-verify'), FIRST)
    const request = db.createFactoryRequest({
      repoId: repo.id,
      title: 'Pin',
      description: 'Use the first skills.',
      agent: 'cursor'
    })
    await pinFactoryRequestBase(db, request.id, repo)
    const pinned = db.getFactoryRequestBase(request.id)
    expect(pinned?.base_commit).toBe(git(repo.path, 'rev-parse', 'HEAD'))

    commitSkill(skillYaml('newer-verify'), SECOND)
    await enableManagedFactoryGate(db, repo)
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

    const [row] = db.listFactoryRunSkills('run_legacy_local')
    expect(row).toMatchObject({
      stage: 'build',
      skill: 'sharpen',
      sha256: createHash('sha256').update(FIRST).digest('hex')
    })
    expect(db.listFactoryRunRiskPaths('run_legacy_local').map((entry) => entry.path)).toEqual([
      'src/payments/**'
    ])
    const dir = await extractRunSkills(db, { runId: 'run_legacy_local', repo })
    expect(dir).toBeTruthy()
    if (dir) {
      expect(readFileSync(join(dir, '.agents', 'skills', 'sharpen', 'SKILL.md'), 'utf8')).toBe(
        FIRST
      )
      rmSync(dir, { recursive: true, force: true })
    }
    expect(db.getFactoryRunConfig('run_legacy_local')?.verify).toBe('team-verify')
  })

  it('fails baseline when factory.skills names an unknown stage', async () => {
    commitSkill(skillYaml('team-verify'), FIRST)
    await enableManagedFactoryGate(db, repo)
    commitSkill(skillYaml('team-verify').replace('build: [sharpen]', 'nope: [sharpen]'), FIRST)
    await expect(
      runFactoryBaseline(
        db,
        host,
        { runId: 'run_legacy_local', worktreeSelector: `id:${repo.id}::${repo.path}` },
        { runner }
      )
    ).rejects.toThrow(/Unknown factory skill stage "nope"/)
  })
})
