import { useCallback, useEffect, useRef, useState } from 'react'
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
import { useAppStore } from '@/store'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'
import type { FactoryGateStatus } from '../../../../shared/factory-types'
import { FactoryRequestDetail } from './FactoryRequestDetail'
import { FactoryRequestForm } from './FactoryRequestForm'
import {
  FACTORY_REQUEST_STAGE_TONE,
  factoryRequestAgeLabel,
  factoryRequestMatchesListFilter,
  factoryRequestStageLabel,
  factoryRequestToOpen,
  type FactoryRequestListFilter
} from './factory-request-presentation'

const POLL_MS = 3_000

/** The requester's whole experience: ask for a change, answer, approve, send — no terminal. */
export function FactoryRequestsSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { open, onOpenChange } = props
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const [requests, setRequests] = useState<FactoryRequestView[]>([])
  const [gates, setGates] = useState<FactoryGateStatus[]>([])
  const [signedInIds, setSignedInIds] = useState<string[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FactoryRequestListFilter>('open')
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(0)
  const refresh = useCallback(() => setTick((value) => value + 1), [])
  const seenIds = useRef(new Set<string>())
  const watchForNew = useRef(false)

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      // Why the array checks: the browser client has no ipcMain and its fallback returns undefined.
      const [nextSignedIn, nextRequests, nextGates]: unknown[] = await Promise.all([
        window.api.factoryRequests.signedInAgents(),
        window.api.factoryRequests.list(),
        window.api.factoryGate.list()
      ])
      if (!cancelled) {
        setSignedInIds(Array.isArray(nextSignedIn) ? nextSignedIn : [])
        setRequests(Array.isArray(nextRequests) ? nextRequests : [])
        setGates(Array.isArray(nextGates) ? nextGates : [])
        setNow(Date.now())
      }
    }
    void load().catch(() => undefined)
    const timer = window.setInterval(() => void load().catch(() => undefined), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [open, tick])

  useEffect(() => {
    if (!open) {
      watchForNew.current = false
      return
    }
    const openedId = factoryRequestToOpen(
      seenIds.current,
      requests,
      watchForNew.current,
      selectedId
    )
    if (openedId) {
      watchForNew.current = false
      setSelectedId(openedId)
    }
    for (const request of requests) {
      seenIds.current.add(request.id)
    }
  }, [open, requests, selectedId])

  const selected = requests.find((request) => request.id === selectedId) ?? null
  const visible = requests.filter((request) =>
    factoryRequestMatchesListFilter(request.stage, filter)
  )
  const filters: { id: FactoryRequestListFilter; label: string }[] = [
    {
      id: 'open',
      label: translate('auto.components.factoryRequests.list.open', 'Open')
    },
    {
      id: 'needsYou',
      label: translate('auto.components.factoryRequests.list.needsYou', 'Your turn')
    },
    {
      id: 'finished',
      label: translate('auto.components.factoryRequests.list.finished', 'Done')
    }
  ]
  const emptyLabel =
    filter === 'needsYou'
      ? translate(
          'auto.components.factoryRequests.list.emptyNeedsYou',
          'Nothing is waiting on you.'
        )
      : filter === 'finished'
        ? translate('auto.components.factoryRequests.list.emptyFinished', 'No finished requests.')
        : translate('auto.components.factoryRequests.list.emptyOpen', 'Nothing in progress.')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="inset-0 h-full w-screen max-w-none sm:max-w-none">
        <SheetHeader>
          <SheetTitle>
            {translate('auto.components.factoryRequests.sheet.title', 'Marham Factory')}
          </SheetTitle>
          <SheetDescription>
            {translate(
              'auto.components.factoryRequests.sheet.description',
              'Tell me what you want. I’ll ask a couple of questions, then build it.'
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 border-t border-border">
          <div className="scrollbar-sleek w-60 shrink-0 space-y-1 overflow-y-auto border-r border-border p-2">
            <Button className="w-full" size="sm" onClick={() => setSelectedId(null)}>
              <Plus />
              {translate('auto.components.factoryRequests.sheet.new', 'New request')}
            </Button>
            <div className="flex flex-wrap gap-1">
              {filters.map((entry) => (
                <Button
                  key={entry.id}
                  size="xs"
                  variant={filter === entry.id ? 'secondary' : 'ghost'}
                  onClick={() => setFilter(entry.id)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
            {visible.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">{emptyLabel}</p>
            ) : null}
            {visible.map((request) => {
              const age = now > 0 ? factoryRequestAgeLabel(request.createdAt, now) : null
              return (
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
                    className="text-xs text-muted-foreground data-[tone=action]:text-status-warning data-[tone=danger]:text-destructive data-[tone=success]:text-status-success"
                  >
                    {factoryRequestStageLabel(request.stage)}
                    {age ? ` · ${age}` : ''}
                  </div>
                </button>
              )
            })}
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
            {selected ? (
              <FactoryRequestDetail request={selected} now={now} onChanged={refresh} />
            ) : (
              <FactoryRequestForm
                key={gates.map((gate) => gate.repoId).join(',')}
                gates={gates}
                signedInIds={signedInIds}
                onSendStarted={() => {
                  watchForNew.current = true
                }}
                onCreated={(requestId) => {
                  setSelectedId(requestId)
                  refresh()
                }}
                onGatesChanged={refresh}
                onSignedIn={refresh}
                onOpenAccounts={(sectionId) => {
                  onOpenChange(false)
                  openSettingsTarget({ pane: 'accounts', repoId: null, sectionId })
                }}
              />
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
