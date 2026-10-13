import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { OrchestrationDb } from '../db'
import { describeFactoryGate, disableFactoryGate, enableFactoryGate } from './factory-gate-approval'
import { resolveFactorySetupScript } from './factory-managed-config'
import {
  FACTORY_SHIPPED_SETUP,
  FACTORY_SHIPPED_VERIFY,
  packageDeclaresExpo
} from './factory-shipped-config'
import { readFactoryVerifyCommand } from './factory-verify-command'

const EXPO_PACKAGE = JSON.stringify({ name: 'marham', dependencies: { expo: '57.0.0' } })

describe('shipped factory check', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function expoRepo(): Repo {
    const path = mkdtempSync(join(tmpdir(), 'orca-factory-shipped-'))
    dirs.push(path)
    writeFileSync(join(path, 'package.json'), EXPO_PACKAGE)
    return { id: 'repo_marham', path, displayName: 'Marham', badgeColor: '', addedAt: 0 }
  }

  it('recognizes an Expo app and ignores everything else', () => {
    expect(packageDeclaresExpo(EXPO_PACKAGE)).toBe(true)
    expect(packageDeclaresExpo('{"dependencies":{"react":"1"}}')).toBe(false)
    expect(packageDeclaresExpo('not json')).toBe(false)
    expect(FACTORY_SHIPPED_VERIFY.includes('\n')).toBe(false)
  })

  it('uses the built-in install and type-check when the project has no orca.yaml', () => {
    const repo = expoRepo()
    expect(readFactoryVerifyCommand(repo.path)).toBe(FACTORY_SHIPPED_VERIFY)
    const db = new OrchestrationDb(':memory:')
    expect(resolveFactorySetupScript(db, repo, 'run_missing')).toBe(FACTORY_SHIPPED_SETUP)
    db.close()
  })

  it('turns the built-in check on, and leaves it off after the person switches it off', () => {
    const repo = expoRepo()
    const db = new OrchestrationDb(':memory:')
    const first = describeFactoryGate(db, repo)
    expect(first).toMatchObject({
      enabled: true,
      builtin: true,
      stale: false,
      unsupportedReason: null
    })

    const off = disableFactoryGate(db, repo)
    expect(off.enabled).toBe(false)
    expect(describeFactoryGate(db, repo).enabled).toBe(false)

    const on = enableFactoryGate(db, repo, { expectedCommand: FACTORY_SHIPPED_VERIFY })
    expect(on.enabled).toBe(true)
    db.close()
  })

  it('keeps a project orca.yaml ahead of the built-in check', () => {
    const repo = expoRepo()
    writeFileSync(join(repo.path, 'orca.yaml'), 'scripts:\n  verify: npm test\n  setup: npm ci\n')
    const db = new OrchestrationDb(':memory:')
    const gate = describeFactoryGate(db, repo)
    expect(gate.command).toBe('npm test')
    expect(gate.builtin).toBe(false)
    expect(gate.enabled).toBe(false)
    expect(resolveFactorySetupScript(db, repo, 'run_yaml')).toBe('npm ci')
    db.close()
  })
})
