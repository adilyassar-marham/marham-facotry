import { ipcMain } from 'electron'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { FactoryGateStatus, FactorySkillCatalog } from '../../shared/factory-types'
import type { FactoryOpenPrResult } from '../../shared/factory-run-types'
import type { Repo } from '../../shared/repo-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  describeFactoryGate,
  disableFactoryGate,
  enableFactoryGate,
  enableManagedFactoryGate
} from '../runtime/orchestration/factory/factory-gate-approval'
import { readCommittedFactoryRules } from '../runtime/orchestration/factory/factory-managed-config'
import { readFactorySkillCatalog } from '../runtime/orchestration/factory/factory-skill-snapshot'
import { openFactoryPullRequest } from '../runtime/orchestration/factory/factory-pr'
import { saveFactoryRepoSettingsFromInput } from '../runtime/orchestration/factory/factory-repo-settings'

type FactoryGateRuntime = Pick<OrcaRuntimeService, 'listRepos' | 'getOrchestrationDb'>

function readField(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null
    ? Object.getOwnPropertyDescriptor(raw, key)?.value
    : undefined
}

function requireRepo(runtime: FactoryGateRuntime, raw: unknown): Repo {
  const repoId = readField(raw, 'repoId')
  const repo =
    typeof repoId === 'string'
      ? runtime.listRepos().find((entry) => entry.id === repoId)
      : undefined
  if (!repo) {
    throw new Error('Unknown repo.')
  }
  return repo
}

const TEAM_RULES_TTL_MS = 60_000
const teamRulesCache = new Map<string, { at: number; value: FactoryGateStatus['teamRules'] }>()
const skillCatalogCache = new Map<string, { at: number; value: FactorySkillCatalog | null }>()

/** The settings list polls; reading committed rules runs git, so it is cached for a minute. */
async function cachedTeamRules(repo: Repo): Promise<FactoryGateStatus['teamRules']> {
  const cached = teamRulesCache.get(repo.id)
  if (cached && Date.now() - cached.at < TEAM_RULES_TTL_MS) {
    return cached.value
  }
  const rules = await readCommittedFactoryRules(repo, { fetch: false })
  const value = rules
    ? { baseRef: rules.baseRef, verify: rules.config.verify, guidelines: rules.config.guidelines }
    : null
  teamRulesCache.set(repo.id, { at: Date.now(), value })
  return value
}

async function cachedSkillCatalog(repo: Repo): Promise<FactorySkillCatalog | null> {
  const cached = skillCatalogCache.get(repo.id)
  if (cached && Date.now() - cached.at < TEAM_RULES_TTL_MS) {
    return cached.value
  }
  const value = await readFactorySkillCatalog(repo)
  skillCatalogCache.set(repo.id, { at: Date.now(), value })
  return value
}

/**
 * Why IPC and not RPC: approving the gate is the trust decision, and only Orca's own renderer can
 * reach ipcMain. Any RPC method would also be callable by the gated agent from its terminal.
 */
export function registerFactoryGateHandlers(runtime: FactoryGateRuntime): void {
  ipcMain.removeHandler('factoryGate:list')
  ipcMain.removeHandler('factoryGate:enable')
  ipcMain.removeHandler('factoryGate:disable')
  ipcMain.handle('factoryGate:list', async (): Promise<FactoryGateStatus[]> => {
    const db = runtime.getOrchestrationDb()
    return Promise.all(
      runtime.listRepos().map(async (repo) => {
        const status = describeFactoryGate(db, repo)
        const localGitRepo =
          getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID && repo.kind !== 'folder'
        if (!localGitRepo) {
          return status
        }
        const skillCatalog = await cachedSkillCatalog(repo)
        if (status.managedBaseRef) {
          return { ...status, skillCatalog }
        }
        return { ...status, teamRules: await cachedTeamRules(repo), skillCatalog }
      })
    )
  })
  ipcMain.removeHandler('factoryGate:enableManaged')
  ipcMain.handle(
    'factoryGate:enableManaged',
    (_event, raw: unknown): Promise<FactoryGateStatus> => {
      teamRulesCache.clear()
      skillCatalogCache.clear()
      return enableManagedFactoryGate(runtime.getOrchestrationDb(), requireRepo(runtime, raw))
    }
  )
  ipcMain.handle('factoryGate:enable', (_event, raw: unknown): FactoryGateStatus => {
    const expectedCommand = readField(raw, 'expectedCommand')
    const timeoutSeconds = readField(raw, 'timeoutSeconds')
    if (typeof expectedCommand !== 'string') {
      throw new Error('Missing the reviewed verify command.')
    }
    return enableFactoryGate(runtime.getOrchestrationDb(), requireRepo(runtime, raw), {
      expectedCommand,
      timeoutSeconds: typeof timeoutSeconds === 'number' ? timeoutSeconds : undefined
    })
  })
  ipcMain.handle('factoryGate:disable', (_event, raw: unknown): FactoryGateStatus =>
    disableFactoryGate(runtime.getOrchestrationDb(), requireRepo(runtime, raw))
  )
  ipcMain.removeHandler('factoryGate:saveSettings')
  ipcMain.handle('factoryGate:saveSettings', (_event, raw: unknown): FactoryGateStatus => {
    const db = runtime.getOrchestrationDb()
    const repo = requireRepo(runtime, raw)
    saveFactoryRepoSettingsFromInput(db, repo, {
      guidelines: readField(raw, 'guidelines'),
      maxWorkers: readField(raw, 'maxWorkers'),
      maxFixRounds: readField(raw, 'maxFixRounds')
    })
    return describeFactoryGate(db, repo)
  })
  // Why IPC: this push is the one door from a factory run to the remote, so only a click opens it.
  ipcMain.removeHandler('factoryGate:openPullRequest')
  ipcMain.handle(
    'factoryGate:openPullRequest',
    async (_event, raw: unknown): Promise<FactoryOpenPrResult> => {
      const db = runtime.getOrchestrationDb()
      const runId = readField(raw, 'runId')
      const title = readField(raw, 'title')
      const run = typeof runId === 'string' ? db.getFactoryRun(runId) : undefined
      if (!run || typeof runId !== 'string') {
        throw new Error('Unknown factory run.')
      }
      return openFactoryPullRequest(db, requireRepo(runtime, { repoId: run.repo_id }), {
        runId,
        title: typeof title === 'string' ? title : undefined
      })
    }
  )
}
