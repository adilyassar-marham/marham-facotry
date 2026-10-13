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

// Why functions: translate() may not run at module top level.
export function factoryRequestStageLabel(stage: FactoryRequestStage): string {
  switch (stage) {
    case 'intake':
      return translate('auto.components.factoryRequests.stage.intake', 'Talking')
    case 'awaiting_brief_approval':
      return translate('auto.components.factoryRequests.stage.briefApproval', 'Needs your go-ahead')
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
