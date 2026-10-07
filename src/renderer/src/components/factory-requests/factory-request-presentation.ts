import { translate } from '@/i18n/i18n'
import type { FactoryRequestStage } from '../../../../shared/factory-request-types'

export type FactoryRequestTone = 'neutral' | 'progress' | 'action' | 'success' | 'danger'

export const FACTORY_REQUEST_STAGE_TONE: Record<FactoryRequestStage, FactoryRequestTone> = {
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

// Why functions: translate() may not run at module top level.
export function factoryRequestStageLabel(stage: FactoryRequestStage): string {
  switch (stage) {
    case 'starting':
      return translate('auto.components.factoryRequests.stage.starting', 'Starting')
    case 'setting_up':
      return translate('auto.components.factoryRequests.stage.settingUp', 'Getting ready')
    case 'question':
      return translate('auto.components.factoryRequests.stage.question', 'Needs your answer')
    case 'planning':
      return translate('auto.components.factoryRequests.stage.planning', 'Planning')
    case 'plan_approval':
      return translate('auto.components.factoryRequests.stage.planApproval', 'Needs your approval')
    case 'building':
      return translate('auto.components.factoryRequests.stage.building', 'Building')
    case 'reviewing':
      return translate('auto.components.factoryRequests.stage.reviewing', 'Checking')
    case 'ready_for_pr':
      return translate('auto.components.factoryRequests.stage.ready', 'Ready to send')
    case 'pr_opened':
      return translate('auto.components.factoryRequests.stage.sent', 'Sent to engineers')
    case 'needs_engineer':
      return translate('auto.components.factoryRequests.stage.needsEngineer', 'Needs an engineer')
    case 'cancelled':
      return translate('auto.components.factoryRequests.stage.cancelled', 'Cancelled')
  }
}

/** The steps a requester sees, in order; each stage lights up the step it belongs to. */
export function factoryRequestSteps(): string[] {
  return [
    translate('auto.components.factoryRequests.step.ready', 'Getting ready'),
    translate('auto.components.factoryRequests.step.understand', 'Understanding your request'),
    translate('auto.components.factoryRequests.step.approve', 'Your approval'),
    translate('auto.components.factoryRequests.step.build', 'Building'),
    translate('auto.components.factoryRequests.step.check', 'Checking against the rules'),
    translate('auto.components.factoryRequests.step.send', 'Send to engineers'),
    translate('auto.components.factoryRequests.step.sent', 'With the engineers')
  ]
}

const STEP_INDEX: Record<FactoryRequestStage, number> = {
  starting: 0,
  setting_up: 0,
  question: 1,
  planning: 1,
  plan_approval: 2,
  building: 3,
  reviewing: 4,
  ready_for_pr: 5,
  pr_opened: 6,
  needs_engineer: -1,
  cancelled: -1
}

export function factoryRequestStepIndex(stage: FactoryRequestStage): number {
  return STEP_INDEX[stage]
}
