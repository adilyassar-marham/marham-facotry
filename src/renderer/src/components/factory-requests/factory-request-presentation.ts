import { translate } from '@/i18n/i18n'
import type { FactoryRequestStage } from '../../../../shared/factory-request-types'

export type FactoryRequestTone = 'neutral' | 'progress' | 'action' | 'success' | 'danger'

export const FACTORY_REQUEST_STAGE_TONE: Record<FactoryRequestStage, FactoryRequestTone> = {
  intake: 'progress',
  awaiting_brief_approval: 'action',
  starting: 'progress',
  setting_up: 'progress',
  question: 'action',
  planning: 'progress',
  plan_approval: 'action',
  building: 'progress',
  reviewing: 'progress',
  ready_for_pr: 'action',
  pr_opened: 'success',
  needs_engineer: 'danger',
  cancelled: 'neutral'
}

export type FactoryRequestListFilter = 'open' | 'needsYou' | 'finished'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// Why functions: translate() may not run at module top level.
export function factoryRequestStageLabel(stage: FactoryRequestStage): string {
  switch (stage) {
    case 'intake':
      return translate('auto.components.factoryRequests.stage.intake', 'Reading')
    case 'awaiting_brief_approval':
      return translate('auto.components.factoryRequests.stage.briefApproval', 'Your turn')
    case 'starting':
      return translate('auto.components.factoryRequests.stage.starting', 'Starting')
    case 'setting_up':
      return translate('auto.components.factoryRequests.stage.settingUp', 'Setting up')
    case 'question':
      return translate('auto.components.factoryRequests.stage.question', 'Your turn')
    case 'planning':
      return translate('auto.components.factoryRequests.stage.planning', 'Planning')
    case 'plan_approval':
      return translate('auto.components.factoryRequests.stage.planApproval', 'Your turn')
    case 'building':
      return translate('auto.components.factoryRequests.stage.building', 'Building')
    case 'reviewing':
      return translate('auto.components.factoryRequests.stage.reviewing', 'Checking')
    case 'ready_for_pr':
      return translate('auto.components.factoryRequests.stage.ready', 'Ready to send')
    case 'pr_opened':
      return translate('auto.components.factoryRequests.stage.sent', 'Sent')
    case 'needs_engineer':
      return translate('auto.components.factoryRequests.stage.needsEngineer', 'Needs an engineer')
    case 'cancelled':
      return translate('auto.components.factoryRequests.stage.cancelled', 'Cancelled')
  }
}

/** 0 Reading, 1 Agree, 2 Building, 3 Checking, 4 Ready. Null when the request is over. */
export function factoryRequestStepIndex(stage: FactoryRequestStage): number | null {
  switch (stage) {
    case 'intake':
      return 0
    case 'question':
    case 'awaiting_brief_approval':
    case 'planning':
    case 'plan_approval':
      return 1
    case 'starting':
    case 'setting_up':
    case 'building':
      return 2
    case 'reviewing':
      return 3
    case 'ready_for_pr':
    case 'pr_opened':
      return 4
    case 'needs_engineer':
    case 'cancelled':
      return null
  }
}

export function factoryRequestStepLabels(): string[] {
  return [
    translate('auto.components.factoryRequests.step.reading', 'Reading'),
    translate('auto.components.factoryRequests.step.agree', 'Agree'),
    translate('auto.components.factoryRequests.step.build', 'Building'),
    translate('auto.components.factoryRequests.step.checking', 'Checking'),
    translate('auto.components.factoryRequests.step.readyShort', 'Ready')
  ]
}

export function factoryRequestAgentLabel(agent: string): string {
  switch (agent) {
    case 'claude':
      return translate('auto.components.factoryRequests.agent.claude', 'Claude')
    case 'cursor':
      return translate('auto.components.factoryRequests.agent.cursor', 'Cursor')
    case 'codex':
      return translate('auto.components.factoryRequests.agent.codex', 'ChatGPT')
    default:
      return agent
  }
}

export function factoryRequestIsFinished(stage: FactoryRequestStage): boolean {
  return stage === 'cancelled' || stage === 'pr_opened' || stage === 'needs_engineer'
}

export function factoryRequestMatchesListFilter(
  stage: FactoryRequestStage,
  filter: FactoryRequestListFilter
): boolean {
  if (filter === 'needsYou') {
    return FACTORY_REQUEST_STAGE_TONE[stage] === 'action'
  }
  if (filter === 'finished') {
    return factoryRequestIsFinished(stage)
  }
  return !factoryRequestIsFinished(stage)
}

/** SQLite datetime('now') is UTC, written as "YYYY-MM-DD HH:MM:SS" with no zone. */
function factoryRequestStartedMs(createdAt: string): number | null {
  const utc =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(createdAt) === true
      ? `${createdAt.replace(' ', 'T')}Z`
      : createdAt
  const started = Date.parse(utc)
  return Number.isNaN(started) ? null : started
}

export function factoryRequestMinutesSince(createdAt: string, nowMs: number): number | null {
  const started = factoryRequestStartedMs(createdAt)
  if (started === null) {
    return null
  }
  return Math.floor(Math.max(0, nowMs - started) / MINUTE_MS)
}

export function factoryRequestAgeLabel(createdAt: string, nowMs: number): string | null {
  const started = factoryRequestStartedMs(createdAt)
  if (started === null) {
    return null
  }
  const elapsed = Math.max(0, nowMs - started)
  if (elapsed < MINUTE_MS) {
    return translate('auto.components.factoryRequests.age.now', 'Just now')
  }
  const minutes = Math.floor(elapsed / MINUTE_MS)
  if (minutes < 60) {
    return translate('auto.components.factoryRequests.age.minutes', '{{value0}} min ago', {
      value0: minutes
    })
  }
  const hours = Math.floor(elapsed / HOUR_MS)
  if (hours < 24) {
    return translate('auto.components.factoryRequests.age.hours', '{{value0}} hr ago', {
      value0: hours
    })
  }
  const days = Math.floor(elapsed / DAY_MS)
  if (days === 1) {
    return translate('auto.components.factoryRequests.age.day', '1 day ago')
  }
  return translate('auto.components.factoryRequests.age.days', '{{value0}} days ago', {
    value0: days
  })
}

/** While the new-request form is waiting, open the request as soon as it appears. */
export function factoryRequestToOpen(
  seenIds: ReadonlySet<string>,
  requests: readonly { id: string }[],
  watching: boolean,
  selectedId: string | null
): string | null {
  if (!watching || selectedId !== null) {
    return null
  }
  return requests.find((request) => !seenIds.has(request.id))?.id ?? null
}
