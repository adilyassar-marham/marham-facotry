import { defineMethod } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  FactoryBoardParams,
  FactoryLandParams,
  FactoryPlanApplyParams,
  FactoryVerifyParams
} from '../../../../shared/rpc-contract/factory-params'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import {
  buildFactoryBoard,
  summarizeFactoryVerify
} from '../../orchestration/factory/factory-board'
import { describeFactoryGate } from '../../orchestration/factory/factory-gate-approval'
import { landFactoryRun, type FactoryLandHost } from '../../orchestration/factory/factory-land'
import { applyFactoryPlan } from '../../orchestration/factory/factory-plan'
import { runFactoryVerify } from '../../orchestration/factory/factory-verify'
import { resolveRunScope } from './orchestration/runs/run-scope'

function factoryLandHost(runtime: OrcaRuntimeService): FactoryLandHost {
  return {
    resolveFactoryWorktreeTarget: (selector) => runtime.resolveFactoryWorktreeTarget(selector),
    createFactoryIntegrationWorktree: async ({ repoId, branch, name, baseBranch }) => {
      const created = await runtime.createManagedWorktree({
        repoSelector: `id:${repoId}`,
        name,
        branchNameOverride: branch,
        ...(baseBranch ? { baseBranch } : {}),
        setupDecision: 'skip',
        activate: false
      })
      return { id: created.worktree.id, path: created.worktree.path }
    }
  }
}

// Why no gate enable/disable here: approval is a trust decision, and any RPC caller — including
// the gated agent — can reach these methods. Approval lives behind renderer-only IPC.
export const FACTORY_METHODS = [
  defineMethod({
    name: 'factory.gateStatus',
    params: null,
    handler: (_params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      return { gates: runtime.listRepos().map((repo) => describeFactoryGate(db, repo)) }
    }
  }),
  defineMethod({
    name: 'factory.verify',
    params: FactoryVerifyParams,
    handler: async (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      if (!db.getTask(params.task)) {
        throw new OrchestrationError('lifecycle_not_found', `Task ${params.task} was not found.`)
      }
      const outcome = await runFactoryVerify(db, runtime, { taskId: params.task })
      return outcome.gated
        ? {
            gated: true,
            command: outcome.command ?? null,
            verify: summarizeFactoryVerify(outcome.result)
          }
        : { gated: false, command: null, verify: null }
    }
  }),
  defineMethod({
    name: 'factory.board',
    params: FactoryBoardParams,
    handler: (params, { runtime }) => buildFactoryBoard(runtime.getOrchestrationDb(), params.run)
  }),
  defineMethod({
    name: 'factory.land',
    params: FactoryLandParams,
    handler: (params, { runtime }) =>
      landFactoryRun(runtime.getOrchestrationDb(), factoryLandHost(runtime), {
        runId: params.run,
        baseBranch: params.base
      })
  }),
  defineMethod({
    name: 'factory.planApply',
    params: FactoryPlanApplyParams,
    handler: (
      params,
      { runtime, legacyCoordinatorRunId, orchestrationCompatibilityEvidence, orchestrationCaller }
    ) => {
      // Same run resolution as `orchestration.taskCreate`, so a plan lands where a task would.
      const run = resolveRunScope(runtime, {
        runId: params.run,
        callerTerminalHandle: params.callerTerminalHandle,
        requireCurrentConsumer: true,
        legacyCoordinatorRunId,
        callerEvidence: orchestrationCompatibilityEvidence,
        callerSession: orchestrationCaller
      })
      const tasks = applyFactoryPlan(runtime.getOrchestrationDb(), {
        runId: run.id,
        tasks: params.tasks,
        createdByTerminalHandle: params.callerTerminalHandle
      })
      return { runId: run.id, tasks }
    }
  })
]
