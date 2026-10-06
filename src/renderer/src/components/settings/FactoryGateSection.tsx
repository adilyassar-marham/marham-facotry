import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { FactoryGateStatus } from '../../../../shared/factory-types'
import { FactoryGateApprovalDialog } from './FactoryGateApprovalDialog'

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

export function FactoryGateSection(): React.JSX.Element {
  const [gates, setGates] = useState<FactoryGateStatus[] | null>(null)
  const [pending, setPending] = useState<FactoryGateStatus | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    // Why the array check: the browser client has no ipcMain and its fallback API returns undefined.
    const result: unknown = await window.api.factoryGate.list()
    setGates(Array.isArray(result) ? result : [])
  }, [])

  useEffect(() => {
    void refresh().catch(() => setGates([]))
  }, [refresh])

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await action()
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-[13px] font-medium text-foreground">
        {translate('auto.components.settings.FactoryGateSection.title', 'Quality gate')}
      </div>
      <p className="text-[12px] leading-snug text-muted-foreground">
        {translate(
          'auto.components.settings.FactoryGateSection.description',
          'Runs your repo’s orca.yaml scripts.verify before a worker’s task can complete. Agents cannot turn it on or off.'
        )}
      </p>
      {gates === null ? null : gates.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          {translate('auto.components.settings.FactoryGateSection.noRepos', 'No repos yet.')}
        </p>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {gates.map((gate) => (
            <div key={gate.repoId} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-foreground">{gate.repoName}</div>
                <div className="truncate font-mono text-[12px] text-muted-foreground">
                  {gate.unsupportedReason ?? gate.command}
                </div>
              </div>
              <span
                data-tone={gateTone(gate)}
                className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground data-[tone=success]:border-status-success-border data-[tone=success]:bg-status-success-background data-[tone=success]:text-status-success data-[tone=warning]:border-status-warning-border data-[tone=warning]:bg-status-warning-background data-[tone=warning]:text-status-warning"
              >
                {gateStateLabel(gate)}
              </span>
              {gate.enabled && !gate.stale ? (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy}
                  onClick={() =>
                    void run(() => window.api.factoryGate.disable({ repoId: gate.repoId }))
                  }
                >
                  {translate('auto.components.settings.FactoryGateSection.disable', 'Turn off')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy || Boolean(gate.unsupportedReason)}
                  onClick={() => setPending(gate)}
                >
                  {gate.stale
                    ? translate('auto.components.settings.FactoryGateSection.reapprove', 'Review')
                    : translate('auto.components.settings.FactoryGateSection.enable', 'Enable')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <FactoryGateApprovalDialog
        gate={pending}
        busy={busy}
        onCancel={() => setPending(null)}
        onApprove={(gate) =>
          void run(async () => {
            await window.api.factoryGate.enable({
              repoId: gate.repoId,
              expectedCommand: gate.command ?? ''
            })
            setPending(null)
          })
        }
      />
    </div>
  )
}
