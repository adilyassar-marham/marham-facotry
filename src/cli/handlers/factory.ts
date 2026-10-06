import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  FACTORY_VERIFY_CLIENT_TIMEOUT_MS,
  type FactoryBoard,
  type FactoryGateStatus,
  type FactoryLandResult,
  type FactoryPlanApplyResult,
  type FactoryVerifySummary
} from '../../shared/factory-types'
import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import {
  formatFactoryBoard,
  formatFactoryGates,
  formatFactoryLand,
  formatFactoryPlan,
  formatFactoryVerify
} from '../factory-format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { callOrchestrationMutation } from './orchestration/mutation-request'
import { resolveCoordinatorTerminalHandle } from './orchestration/terminal-identity'

// Why both shapes: agents often emit a bare array; the documented form wraps it in { tasks }.
async function readPlanTasks(path: string): Promise<unknown> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new RuntimeClientError('invalid_argument', `Cannot read plan file ${path}: ${reason}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new RuntimeClientError('invalid_argument', `Plan file ${path} is not valid JSON.`)
  }
  return Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && 'tasks' in parsed
      ? Object.getOwnPropertyDescriptor(parsed, 'tasks')?.value
      : undefined
}

export const FACTORY_HANDLERS: Record<string, CommandHandler> = {
  'factory plan': async ({ flags, client, cwd, json }) => {
    const tasks = await readPlanTasks(resolve(cwd, getRequiredStringFlag(flags, 'file')))
    if (!Array.isArray(tasks)) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Plan file must be [tasks…] or { "tasks": [...] }.'
      )
    }
    const callerTerminalHandle = await resolveCoordinatorTerminalHandle(flags, cwd, client)
    const result = await callOrchestrationMutation<FactoryPlanApplyResult>(
      client,
      flags,
      'factory.planApply',
      // The RPC schema validates each task's shape; the CLI only forwards it.
      { tasks, run: getOptionalStringFlag(flags, 'run'), callerTerminalHandle }
    )
    printResult(result, json, formatFactoryPlan)
  },
  'factory verify': async ({ flags, client, json }) => {
    const result = await client.call<{
      gated: boolean
      command: string | null
      verify: FactoryVerifySummary | null
    }>(
      'factory.verify',
      { task: getRequiredStringFlag(flags, 'task') },
      { timeoutMs: FACTORY_VERIFY_CLIENT_TIMEOUT_MS }
    )
    printResult(result, json, formatFactoryVerify)
  },
  'factory board': async ({ flags, client, json }) => {
    const result = await client.call<FactoryBoard>('factory.board', {
      run: getOptionalStringFlag(flags, 'run')
    })
    printResult(result, json, formatFactoryBoard)
  },
  'factory land': async ({ flags, client, json }) => {
    // Why the long timeout: land ends by running the verify suite on the combined branch.
    const result = await client.call<FactoryLandResult>(
      'factory.land',
      { run: getRequiredStringFlag(flags, 'run'), base: getOptionalStringFlag(flags, 'base') },
      { timeoutMs: FACTORY_VERIFY_CLIENT_TIMEOUT_MS }
    )
    printResult(result, json, formatFactoryLand)
  },
  'factory gate status': async ({ client, json }) => {
    const result = await client.call<{ gates: FactoryGateStatus[] }>('factory.gateStatus')
    printResult(result, json, formatFactoryGates)
  }
}
