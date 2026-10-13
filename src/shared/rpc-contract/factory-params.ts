import { z } from 'zod'
import { OptionalFiniteNumber, OptionalString, requiredString } from './rpc-param-primitives'

export const FactoryBoardParams = z.object({
  run: OptionalString
})

export const FactoryVerifyParams = z.object({
  task: requiredString('Missing --task')
})

export const FactoryLandParams = z.object({
  run: requiredString('Missing --run'),
  base: OptionalString
})

const FactoryPlanTask = z.object({
  key: z.string().min(1),
  title: z.string().optional(),
  spec: z.string(),
  acceptance: z.array(z.string()).optional(),
  deps: z.array(z.string()).optional()
})

export const FactoryPlanApplyParams = z.object({
  run: OptionalString,
  callerTerminalHandle: OptionalString,
  tasks: z.array(FactoryPlanTask).min(1, 'A factory plan needs at least one task')
})

export const FactoryBaselineParams = z.object({
  run: requiredString('Missing --run'),
  base: OptionalString,
  /** The coordinator's worktree; the CLI sends `path:<cwd>` when --worktree is absent. */
  worktree: requiredString('Missing --worktree'),
  /** Links the run to the teammate request it was started for. */
  request: OptionalString
})

export const FactoryAskParams = z.object({
  run: requiredString('Missing --run'),
  question: OptionalString,
  questionId: OptionalString,
  waitSeconds: OptionalFiniteNumber
})

export const FactoryAwaitApprovalParams = z.object({
  run: requiredString('Missing --run'),
  waitSeconds: OptionalFiniteNumber
})

export const FactoryRunParams = z.object({
  run: requiredString('Missing --run')
})

export const FactoryBriefKindSchema = z.enum([
  'app_only',
  'needs_backend',
  'app_and_backend',
  'needs_native',
  'not_feasible'
])

export const FactoryBriefBody = z.object({
  person: z.string().min(1),
  agent: z.string().min(1),
  kind: FactoryBriefKindSchema,
  acceptance: z.array(z.string().min(1)).min(1).max(30)
})

export const FactorySayParams = z.object({
  request: requiredString('Missing --request'),
  text: requiredString('Missing --text')
})

export const FactoryAskRequestParams = z.object({
  request: requiredString('Missing --request'),
  question: OptionalString,
  questionId: OptionalString,
  choices: z.array(z.string()).optional(),
  recommended: OptionalFiniteNumber,
  why: OptionalString,
  waitSeconds: OptionalFiniteNumber
})

export const FactoryBriefParams = z.object({
  request: requiredString('Missing --request'),
  brief: FactoryBriefBody
})

export const FactoryAwaitBriefParams = z.object({
  request: requiredString('Missing --request'),
  waitSeconds: OptionalFiniteNumber
})
