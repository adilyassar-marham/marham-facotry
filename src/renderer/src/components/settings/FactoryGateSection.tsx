import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { FactoryGateStatus } from '../../../../shared/factory-types'
import { FactoryGateApprovalDialog } from './FactoryGateApprovalDialog'
import { FactoryGateRow } from './FactoryGateRow'
import { FactoryRepoSettingsDialog } from './FactoryRepoSettingsDialog'

export function FactoryGateSection(): React.JSX.Element {
  const [gates, setGates] = useState<FactoryGateStatus[] | null>(null)
  const [pending, setPending] = useState<FactoryGateStatus | null>(null)
  const [editing, setEditing] = useState<FactoryGateStatus | null>(null)
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
            <FactoryGateRow
              key={gate.repoId}
              gate={gate}
              busy={busy}
              onEdit={() => setEditing(gate)}
              onReview={() => setPending(gate)}
              onDisable={() =>
                void run(() => window.api.factoryGate.disable({ repoId: gate.repoId }))
              }
              onUseTeamRules={() =>
                void run(() => window.api.factoryGate.enableManaged({ repoId: gate.repoId }))
              }
            />
          ))}
        </div>
      )}
      <FactoryRepoSettingsDialog
        key={editing?.repoId ?? 'closed'}
        gate={editing}
        busy={busy}
        onCancel={() => setEditing(null)}
        onSave={(draft) =>
          void run(async () => {
            await window.api.factoryGate.saveSettings(draft)
            setEditing(null)
          })
        }
      />
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
