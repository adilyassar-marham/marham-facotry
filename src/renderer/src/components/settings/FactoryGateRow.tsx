import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { FactoryGateStatus } from '../../../../shared/factory-types'

function gateTone(gate: FactoryGateStatus): 'success' | 'warning' | 'neutral' {
  return gate.stale ? 'warning' : gate.enabled ? 'success' : 'neutral'
}

function gateStateLabel(gate: FactoryGateStatus): string {
  if (gate.stale) {
    return translate('auto.components.settings.FactoryGateSection.stale', 'Needs re-approval')
  }
  return gate.enabled
    ? translate('auto.components.settings.FactoryGateSection.on', 'On')
    : translate('auto.components.settings.FactoryGateSection.off', 'Off')
}

function GateDetail({ gate }: { gate: FactoryGateStatus }): React.JSX.Element {
  if (gate.managedBaseRef) {
    return (
      <div className="truncate text-[12px] text-muted-foreground">
        {translate(
          'auto.components.settings.FactoryGateRow.managed',
          'Team rules from {{value0}}: check command, setup and guidelines come from orca.yaml there',
          { value0: gate.managedBaseRef }
        )}
      </div>
    )
  }
  return (
    <>
      {gate.builtin ? (
        <div className="truncate text-[12px] text-muted-foreground">
          {translate(
            'auto.components.settings.FactoryGateRow.builtin',
            'Ready. This app installs dependencies and type-checks on its own.'
          )}
        </div>
      ) : (
        <div className="truncate font-mono text-[12px] text-muted-foreground">
          {gate.teamRules && !gate.command
            ? gate.teamRules.verify
            : (gate.unsupportedReason ?? gate.command)}
        </div>
      )}
      {gate.unsupportedReason ? null : (
        <div className="truncate text-[12px] text-muted-foreground">
          {gate.settings.guidelines.length > 0
            ? translate(
                'auto.components.settings.FactoryGateSection.guidelines',
                'Review against {{value0}}',
                { value0: gate.settings.guidelines.join(', ') }
              )
            : translate(
                'auto.components.settings.FactoryGateSection.noGuidelines',
                'No guideline files: reviews check acceptance criteria only'
              )}
        </div>
      )}
    </>
  )
}

export function FactoryGateRow(props: {
  gate: FactoryGateStatus
  busy: boolean
  onEdit: () => void
  onReview: () => void
  onDisable: () => void
  onUseTeamRules: () => void
}): React.JSX.Element {
  const { gate, busy } = props
  const offerTeamRules = !gate.enabled && gate.teamRules !== null
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-foreground">{gate.repoName}</div>
        <GateDetail gate={gate} />
      </div>
      {gate.managedBaseRef ? null : (
        <Button
          variant="ghost"
          size="xs"
          disabled={busy || Boolean(gate.unsupportedReason)}
          onClick={props.onEdit}
        >
          {translate('auto.components.settings.FactoryGateSection.settings', 'Settings')}
        </Button>
      )}
      <span
        data-tone={gateTone(gate)}
        className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground data-[tone=success]:border-status-success-border data-[tone=success]:bg-status-success-background data-[tone=success]:text-status-success data-[tone=warning]:border-status-warning-border data-[tone=warning]:bg-status-warning-background data-[tone=warning]:text-status-warning"
      >
        {gateStateLabel(gate)}
      </span>
      {offerTeamRules ? (
        <Button size="xs" disabled={busy} onClick={props.onUseTeamRules}>
          {translate('auto.components.settings.FactoryGateRow.useTeamRules', 'Use team rules')}
        </Button>
      ) : null}
      {gate.enabled && !gate.stale ? (
        <Button variant="outline" size="xs" disabled={busy} onClick={props.onDisable}>
          {translate('auto.components.settings.FactoryGateSection.disable', 'Turn off')}
        </Button>
      ) : gate.command ? (
        <Button
          variant="outline"
          size="xs"
          disabled={busy || Boolean(gate.unsupportedReason)}
          onClick={props.onReview}
        >
          {gate.stale
            ? translate('auto.components.settings.FactoryGateSection.reapprove', 'Review')
            : translate('auto.components.settings.FactoryGateSection.enable', 'Enable')}
        </Button>
      ) : null}
    </div>
  )
}
