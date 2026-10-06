import { ipcMain } from 'electron'
import type { FactoryGateStatus } from '../../shared/factory-types'
import type { Repo } from '../../shared/repo-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  describeFactoryGate,
  disableFactoryGate,
  enableFactoryGate
} from '../runtime/orchestration/factory/factory-gate-approval'

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

/**
 * Why IPC and not RPC: approving the gate is the trust decision, and only Orca's own renderer can
 * reach ipcMain. Any RPC method would also be callable by the gated agent from its terminal.
 */
export function registerFactoryGateHandlers(runtime: FactoryGateRuntime): void {
  ipcMain.removeHandler('factoryGate:list')
  ipcMain.removeHandler('factoryGate:enable')
  ipcMain.removeHandler('factoryGate:disable')
  ipcMain.handle('factoryGate:list', (): FactoryGateStatus[] => {
    const db = runtime.getOrchestrationDb()
    return runtime.listRepos().map((repo) => describeFactoryGate(db, repo))
  })
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
}
