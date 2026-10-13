import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  FACTORY_REQUEST_WAIT_DEFAULT_SECONDS,
  type FactoryApprovalWaitResult,
  type FactoryAskResult,
  type FactoryBriefWaitResult
} from '../../shared/factory-request-types'
import type {
  FactoryBaselineResult,
  FactoryCleanupResult,
  FactoryReviewStartResult
} from '../../shared/factory-run-types'
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
import {
  formatFactoryAsk,
  formatFactoryAwaitApproval,
  formatFactoryAwaitBrief,
  formatFactoryBaseline,
  formatFactoryBriefSaved,
  formatFactoryCleanup,
  formatFactoryFix,
  formatFactoryReviewStart
} from '../factory-run-format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRepeatedStringFlag,
  getRequiredStringFlag
} from '../flags'
import { getOptionalWorktreeSelector, resolveCurrentWorktreeSelector } from '../selectors'
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

async function readBriefFile(path: string): Promise<unknown> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new RuntimeClientError('invalid_argument', `Cannot read brief file ${path}: ${reason}`)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new RuntimeClientError('invalid_argument', `Brief file ${path} is not valid JSON.`)
  }
}

function readWaitSeconds(flags: Map<string, string | boolean>): number {
  const raw = getOptionalStringFlag(flags, 'wait-seconds')
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : FACTORY_REQUEST_WAIT_DEFAULT_SECONDS
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
    // Why the long timeout: land re-runs setup, then the verify suite on the combined branch.
    const result = await client.call<FactoryLandResult>(
      'factory.land',
      { run: getRequiredStringFlag(flags, 'run'), base: getOptionalStringFlag(flags, 'base') },
      { timeoutMs: FACTORY_VERIFY_CLIENT_TIMEOUT_MS * 2 }
    )
    printResult(result, json, formatFactoryLand)
  },
  'factory baseline': async ({ flags, client, cwd, json }) => {
    // Why the long timeout: baseline runs the repo setup (e.g. npm install) and then verify.
    const result = await client.call<FactoryBaselineResult>(
      'factory.baseline',
      {
        run: getRequiredStringFlag(flags, 'run'),
        base: getOptionalStringFlag(flags, 'base'),
        request: getOptionalStringFlag(flags, 'request'),
        worktree:
          (await getOptionalWorktreeSelector(flags, 'worktree', cwd, client)) ??
          (await resolveCurrentWorktreeSelector(cwd, client))
      },
      { timeoutMs: FACTORY_VERIFY_CLIENT_TIMEOUT_MS * 2 }
    )
    printResult(result, json, formatFactoryBaseline)
  },
  'factory ask': async ({ flags, client, json }) => {
    const waitSeconds = readWaitSeconds(flags)
    const request = getOptionalStringFlag(flags, 'request')
    const run = getOptionalStringFlag(flags, 'run')
    if (request && run) {
      throw new RuntimeClientError('invalid_argument', 'Pass --request or --run, not both.')
    }
    if (!request && !run) {
      throw new RuntimeClientError('invalid_argument', 'Pass --request or --run.')
    }
    const result = request
      ? await client.call<FactoryAskResult>(
          'factory.askRequest',
          {
            request,
            question: getOptionalStringFlag(flags, 'question'),
            questionId: getOptionalStringFlag(flags, 'question-id'),
            choices: getRepeatedStringFlag(flags, 'choice'),
            recommended: getOptionalPositiveIntegerFlag(flags, 'recommended'),
            why: getOptionalStringFlag(flags, 'why'),
            waitSeconds
          },
          { timeoutMs: (waitSeconds + 60) * 1000 }
        )
      : await client.call<FactoryAskResult>(
          'factory.ask',
          {
            run,
            question: getOptionalStringFlag(flags, 'question'),
            questionId: getOptionalStringFlag(flags, 'question-id'),
            waitSeconds
          },
          { timeoutMs: (waitSeconds + 60) * 1000 }
        )
    printResult(result, json, (value) => formatFactoryAsk(value, request ? 'request' : 'run'))
  },
  'factory say': async ({ flags, client, json }) => {
    const request = getRequiredStringFlag(flags, 'request')
    const result = await client.call<{ requestId: string }>('factory.say', {
      request,
      text: getRequiredStringFlag(flags, 'text')
    })
    printResult(result, json, () => `Posted on ${request}.`)
  },
  'factory brief': async ({ flags, client, cwd, json }) => {
    const request = getRequiredStringFlag(flags, 'request')
    const result = await client.call<{ requestId: string; version: number }>('factory.brief', {
      request,
      brief: await readBriefFile(resolve(cwd, getRequiredStringFlag(flags, 'file')))
    })
    printResult(result, json, formatFactoryBriefSaved)
  },
  'factory await-brief': async ({ flags, client, json }) => {
    const waitSeconds = readWaitSeconds(flags)
    const result = await client.call<FactoryBriefWaitResult>(
      'factory.awaitBrief',
      { request: getRequiredStringFlag(flags, 'request'), waitSeconds },
      { timeoutMs: (waitSeconds + 60) * 1000 }
    )
    printResult(result, json, formatFactoryAwaitBrief)
  },
  'factory await-approval': async ({ flags, client, json }) => {
    const waitSeconds = readWaitSeconds(flags)
    const result = await client.call<FactoryApprovalWaitResult>(
      'factory.awaitApproval',
      { run: getRequiredStringFlag(flags, 'run'), waitSeconds },
      { timeoutMs: (waitSeconds + 60) * 1000 }
    )
    printResult(result, json, formatFactoryAwaitApproval)
  },
  'factory review': async ({ flags, client, json }) => {
    const result = await client.call<FactoryReviewStartResult>('factory.review', {
      run: getRequiredStringFlag(flags, 'run')
    })
    printResult(result, json, formatFactoryReviewStart)
  },
  'factory fix': async ({ flags, client, json }) => {
    const result = await client.call<{
      runId: string
      round: number
      fixTaskId: string
      integrationBranch: string
    }>('factory.fix', { run: getRequiredStringFlag(flags, 'run') })
    printResult(result, json, formatFactoryFix)
  },
  'factory cleanup': async ({ flags, client, json }) => {
    const result = await client.call<FactoryCleanupResult>(
      'factory.cleanup',
      { run: getRequiredStringFlag(flags, 'run') },
      { timeoutMs: FACTORY_VERIFY_CLIENT_TIMEOUT_MS }
    )
    printResult(result, json, formatFactoryCleanup)
  },
  'factory gate status': async ({ client, json }) => {
    const result = await client.call<{ gates: FactoryGateStatus[] }>('factory.gateStatus')
    printResult(result, json, formatFactoryGates)
  }
}
