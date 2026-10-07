import { app, ipcMain } from 'electron'
import type {
  FactoryRequestStartResult,
  FactoryRequestView
} from '../../shared/factory-request-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  createFactoryRequestRecord,
  decideFactoryPlan
} from '../runtime/orchestration/factory/factory-request'
import { listFactoryRequestViews } from '../runtime/orchestration/factory/factory-request-view'
import type { FactoryCoordinatorLaunch } from './factory-request-launch'

type FactoryRequestRuntime = Pick<
  OrcaRuntimeService,
  'listRepos' | 'getOrchestrationDb' | 'stopTerminalsForWorktree'
>

function field(raw: unknown, key: string): unknown {
  return typeof raw === 'object' && raw !== null
    ? Object.getOwnPropertyDescriptor(raw, key)?.value
    : undefined
}

function requiredString(raw: unknown, key: string): string {
  const value = field(raw, key)
  if (typeof value !== 'string' || !value) {
    throw new Error(`Missing ${key}.`)
  }
  return value
}

/**
 * Why IPC and not RPC: answering, approving and cancelling are the requester's decisions, and an
 * agent can reach every RPC method from its own terminal.
 */
export function registerFactoryRequestHandlers(
  runtime: FactoryRequestRuntime,
  launchCoordinator: FactoryCoordinatorLaunch
): void {
  const channels = [
    'factoryRequests:list',
    'factoryRequests:create',
    'factoryRequests:answer',
    'factoryRequests:decidePlan',
    'factoryRequests:cancel'
  ]
  channels.forEach((channel) => ipcMain.removeHandler(channel))
  const db = (): ReturnType<FactoryRequestRuntime['getOrchestrationDb']> =>
    runtime.getOrchestrationDb()

  ipcMain.handle('factoryRequests:list', (): FactoryRequestView[] => listFactoryRequestViews(db()))
  ipcMain.handle(
    'factoryRequests:create',
    async (_event, raw: unknown): Promise<FactoryRequestStartResult> => {
      const repoId = requiredString(raw, 'repoId')
      if (!runtime.listRepos().some((repo) => repo.id === repoId)) {
        throw new Error('Unknown project.')
      }
      if (!db().getFactoryGateApproval(repoId)) {
        throw new Error('An engineer must turn on the quality gate for this project first.')
      }
      const agent = requiredString(raw, 'agent')
      const created = createFactoryRequestRecord(db(), {
        repoId,
        title: field(raw, 'title'),
        description: field(raw, 'description'),
        agent,
        cli: app.isPackaged ? 'orca' : 'orca-dev'
      })
      try {
        const { worktreeId } = await launchCoordinator({
          repoId,
          agent,
          workspaceName: created.workspaceName,
          prompt: created.coordinatorPrompt
        })
        db().setFactoryRequestWorktree(created.requestId, worktreeId)
        return { requestId: created.requestId, worktreeId }
      } catch (error) {
        // A request whose agent never started must not sit in the list as "Starting" forever.
        db().cancelFactoryRequest(created.requestId)
        throw error
      }
    }
  )
  ipcMain.handle('factoryRequests:answer', (_event, raw: unknown): void => {
    const answer = requiredString(raw, 'answer').trim()
    if (!answer || !db().answerFactoryQuestion(requiredString(raw, 'questionId'), answer)) {
      throw new Error('That question was already answered.')
    }
  })
  ipcMain.handle('factoryRequests:decidePlan', (_event, raw: unknown): void => {
    decideFactoryPlan(db(), {
      runId: requiredString(raw, 'runId'),
      approve: field(raw, 'approve') === true,
      feedback: field(raw, 'feedback')
    })
  })
  ipcMain.handle('factoryRequests:cancel', async (_event, raw: unknown): Promise<void> => {
    const request = db().getFactoryRequest(requiredString(raw, 'requestId'))
    if (!request) {
      throw new Error('Unknown request.')
    }
    db().cancelFactoryRequest(request.id)
    if (request.worktree_id) {
      // Best effort: a stopped coordinator cannot keep spending the requester's agent usage.
      await runtime.stopTerminalsForWorktree(`id:${request.worktree_id}`).catch(() => undefined)
    }
  })
}
