import { translate } from '@/i18n/i18n'
import type { FactoryStage } from '../../../../shared/factory-types'

export type FactoryTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger'

export const FACTORY_STAGE_TONE: Record<FactoryStage, FactoryTone> = {
  planned: 'neutral',
  building: 'progress',
  verifying: 'progress',
  verify_failed: 'danger',
  review: 'warning',
  landed: 'success',
  failed: 'danger',
  blocked: 'warning'
}

// Why a function: translate() may not run at module top level.
export function factoryStageLabel(stage: FactoryStage): string {
  switch (stage) {
    case 'planned':
      return translate('auto.components.settings.FactoryBoard.stagePlanned', 'Planned')
    case 'building':
      return translate('auto.components.settings.FactoryBoard.stageBuilding', 'Building')
    case 'verifying':
      return translate('auto.components.settings.FactoryBoard.stageVerifying', 'Verifying')
    case 'verify_failed':
      return translate('auto.components.settings.FactoryBoard.stageVerifyFailed', 'Verify failed')
    case 'review':
      return translate('auto.components.settings.FactoryBoard.stageReview', 'Ready to land')
    case 'landed':
      return translate('auto.components.settings.FactoryBoard.stageLanded', 'Landed')
    case 'failed':
      return translate('auto.components.settings.FactoryBoard.stageFailed', 'Failed')
    case 'blocked':
      return translate('auto.components.settings.FactoryBoard.stageBlocked', 'Blocked')
  }
}
