import { useCallback, useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { translate } from '@/i18n/i18n'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'
import type { FactoryGateStatus } from '../../../../shared/factory-types'
import { FactoryRequestDetail } from './FactoryRequestDetail'
import { FactoryRequestForm } from './FactoryRequestForm'
import {
  FACTORY_REQUEST_STAGE_TONE,
  factoryRequestStageLabel
} from './factory-request-presentation'

const POLL_MS = 3_000

/** The requester's whole experience: ask for a change, answer, approve, send — no terminal. */
export function FactoryRequestsSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { open, onOpenChange } = props
  const [requests, setRequests] = useState<FactoryRequestView[]>([])
  const [gates, setGates] = useState<FactoryGateStatus[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      // Why the array checks: the browser client has no ipcMain and its fallback returns undefined.
      const [nextRequests, nextGates]: unknown[] = await Promise.all([
        window.api.factoryRequests.list(),
        window.api.factoryGate.list()
      ])
      if (!cancelled) {
        setRequests(Array.isArray(nextRequests) ? nextRequests : [])
        setGates(Array.isArray(nextGates) ? nextGates : [])
      }
    }
    void load().catch(() => undefined)
    const timer = window.setInterval(() => void load().catch(() => undefined), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open, tick])

  const selected = requests.find((request) => request.id === selectedId) ?? null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[920px]">
        <SheetHeader>
          <SheetTitle>
            {translate('auto.components.factoryRequests.sheet.title', 'Requests')}
          </SheetTitle>
          <SheetDescription>
            {translate(
              'auto.components.factoryRequests.sheet.description',
              'Describe a change. The factory builds it, checks it against the team’s rules, and sends it to engineers for review.'
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 border-t border-border">
          <div className="scrollbar-sleek w-64 shrink-0 space-y-1 overflow-y-auto border-r border-border p-2">
            <Button className="w-full" size="sm" onClick={() => setSelectedId(null)}>
              <Plus />
              {translate('auto.components.factoryRequests.sheet.new', 'New request')}
            </Button>
            {requests.map((request) => (
              <button
                key={request.id}
                type="button"
                data-selected={request.id === selectedId}
                className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent data-[selected=true]:bg-accent"
                onClick={() => setSelectedId(request.id)}
              >
                <div className="truncate text-[13px] text-foreground">{request.title}</div>
                <div
                  data-tone={FACTORY_REQUEST_STAGE_TONE[request.stage]}
                  className="text-[11px] text-muted-foreground data-[tone=action]:text-status-warning data-[tone=danger]:text-destructive data-[tone=success]:text-status-success"
                >
                  {factoryRequestStageLabel(request.stage)}
                </div>
              </button>
            ))}
          </div>
          <div className="scrollbar-sleek min-w-0 flex-1 overflow-y-auto p-4">
            {selected ? (
              <FactoryRequestDetail request={selected} onChanged={refresh} />
            ) : (
              <FactoryRequestForm
                key={gates.map((gate) => gate.repoId).join(',')}
                gates={gates}
                onCreated={(requestId) => {
                  setSelectedId(requestId)
                  refresh()
                }}
                onGatesChanged={refresh}
              />
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
