import { defineMethod } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import {
  FactoryAskParams,
  FactoryAskRequestParams,
  FactoryAwaitApprovalParams,
  FactoryAwaitBriefParams,
  FactoryBaselineParams,
  FactoryBoardParams,
  FactoryBriefParams,
  FactoryLandParams,
  FactoryPlanApplyParams,
  FactoryRunParams,
  FactorySayParams,
  FactoryVerifyParams
} from '../../../../shared/rpc-contract/factory-params'
import { OrchestrationError } from '../../orchestration/orchestration-error'
import {
  buildFactoryBoard,
  summarizeFactoryVerify
} from '../../orchestration/factory/factory-board'
import { describeFactoryGate } from '../../orchestration/factory/factory-gate-approval'
import { landFactoryRun } from '../../orchestration/factory/factory-land'
import { runFactoryBaseline } from '../../orchestration/factory/factory-baseline'
import {
  askFactoryRequester,
  awaitFactoryPlanApproval
} from '../../orchestration/factory/factory-request'
import {
  askFactoryRequest,
  awaitFactoryBrief,
  sayFactoryRequest,
  submitFactoryBrief
} from '../../orchestration/factory/factory-intake'
import {
  cleanupFactoryRun,
  type FactoryCleanupHost
} from '../../orchestration/factory/factory-cleanup'
import type { FactoryIntegrationHost } from '../../orchestration/factory/factory-integration'
import {
  createFactoryFixTask,
  startFactoryReview
} from '../../orchestration/factory/factory-review'
import { applyFactoryPlan } from '../../orchestration/factory/factory-plan'
import { runFactoryVerify } from '../../orchestration/factory/factory-verify'
import { resolveRunScope } from './orchestration/runs/run-scope'

function factoryHost(runtime: OrcaRuntimeService): FactoryIntegrationHost & FactoryCleanupHost {
  return {
    removeFactoryWorktree: async (worktreeId) => {
      // Why force: cleanup already proved nothing but .orca/ scratch and ignored files remain.
      await runtime.removeManagedWorktree(`id:${worktreeId}`, {
        force: true,
        waitForBackgroundRemoval: true
      })
    },
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

// Why no gate approval, repo settings, or PR opening here: those are a person's decisions, and any
// RPC caller — including the gated agent — can reach these methods. They live behind renderer IPC.
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
      landFactoryRun(runtime.getOrchestrationDb(), factoryHost(runtime), {
        runId: params.run,
        baseBranch: params.base
      })
  }),
  defineMethod({
    name: 'factory.baseline',
    params: FactoryBaselineParams,
    handler: (params, { runtime }) =>
      runFactoryBaseline(runtime.getOrchestrationDb(), factoryHost(runtime), {
        runId: params.run,
        worktreeSelector: params.worktree,
        baseBranch: params.base,
        requestId: params.request
      })
  }),
  defineMethod({
    name: 'factory.ask',
    params: FactoryAskParams,
    handler: (params, { runtime, signal }) =>
      askFactoryRequester(
        runtime.getOrchestrationDb(),
        {
          runId: params.run,
          question: params.question,
          questionId: params.questionId,
          waitSeconds: params.waitSeconds
        },
        signal
      )
  }),
  defineMethod({
    name: 'factory.awaitApproval',
    params: FactoryAwaitApprovalParams,
    handler: (params, { runtime, signal }) =>
      awaitFactoryPlanApproval(
        runtime.getOrchestrationDb(),
        { runId: params.run, waitSeconds: params.waitSeconds },
        signal
      )
  }),
  defineMethod({
    name: 'factory.review',
    params: FactoryRunParams,
    handler: (params, { runtime }) =>
      startFactoryReview(runtime.getOrchestrationDb(), factoryHost(runtime), { runId: params.run })
  }),
  defineMethod({
    name: 'factory.fix',
    params: FactoryRunParams,
    handler: (params, { runtime }) =>
      createFactoryFixTask(runtime.getOrchestrationDb(), factoryHost(runtime), {
        runId: params.run
      })
  }),
  defineMethod({
    name: 'factory.cleanup',
    params: FactoryRunParams,
    handler: (params, { runtime }) =>
      cleanupFactoryRun(runtime.getOrchestrationDb(), factoryHost(runtime), { runId: params.run })
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
  }),
  defineMethod({
    name: 'factory.say',
    params: FactorySayParams,
    handler: (params, { runtime }) => {
      sayFactoryRequest(runtime.getOrchestrationDb(), {
        requestId: params.request,
        text: params.text
      })
      return { requestId: params.request }
    }
  }),
  defineMethod({
    name: 'factory.askRequest',
    params: FactoryAskRequestParams,
    handler: (params, { runtime, signal }) =>
      askFactoryRequest(
        runtime.getOrchestrationDb(),
        {
          requestId: params.request,
          question: params.question,
          questionId: params.questionId,
          choices: params.choices,
          recommended: params.recommended,
          why: params.why,
          waitSeconds: params.waitSeconds
        },
        signal
      )
  }),
  defineMethod({
    name: 'factory.brief',
    params: FactoryBriefParams,
    handler: (params, { runtime }) =>
      submitFactoryBrief(runtime.getOrchestrationDb(), {
        requestId: params.request,
        brief: params.brief
      })
  }),
  defineMethod({
    name: 'factory.awaitBrief',
    params: FactoryAwaitBriefParams,
    handler: (params, { runtime, signal }) =>
      awaitFactoryBrief(
        runtime.getOrchestrationDb(),
        { requestId: params.request, waitSeconds: params.waitSeconds },
        signal
      )
  })
]
