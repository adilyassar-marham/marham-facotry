import { translate } from '@/i18n/i18n'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'
import { Loader2 } from 'lucide-react'
import { factoryRequestStatusText, factoryRequestWorkingReply } from './factory-request-chat'
import { factoryRequestStepIndex, factoryRequestStepLabels } from './factory-request-presentation'

/** Where a request is, in plain words. The checks and the pull request stay in the background. */
export function FactoryLiveRail(props: { request: FactoryRequestView | null }): React.JSX.Element {
  const { request } = props
  const stepIndex = request ? factoryRequestStepIndex(request.stage) : null
  const working = request ? factoryRequestWorkingReply(request) : null
  const steps = factoryRequestStepLabels()
  return (
    <aside className="scrollbar-sleek flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card px-4 py-4">
      <div>
        <p className="text-xs font-medium tracking-tight text-muted-foreground">
          {translate('auto.components.factoryRequests.live.heading', 'Live')}
        </p>
        <p className="mt-1 flex items-center gap-2 text-sm text-foreground">
          {working ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
          <span>
            {working ??
              (request
                ? factoryRequestStatusText(request)
                : translate(
                    'auto.components.factoryRequests.live.waiting',
                    'Progress shows up here as soon as you send a request.'
                  ))}
          </span>
        </p>
      </div>
      {stepIndex === null ? null : (
        <ol className="space-y-0">
          {steps.map((label, index) => {
            const state = index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'later'
            return (
              <li key={label} data-state={state} className="group flex gap-3">
                <span className="flex w-3 flex-col items-center">
                  <span className="mt-1 size-2 rounded-full border border-border bg-background group-data-[state=current]:animate-pulse group-data-[state=current]:border-foreground group-data-[state=current]:bg-foreground group-data-[state=done]:border-foreground group-data-[state=done]:bg-foreground" />
                  {index < steps.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
                </span>
                <span className="pb-3 text-[13px] text-muted-foreground group-data-[state=current]:font-medium group-data-[state=current]:text-foreground group-data-[state=done]:text-foreground">
                  {label}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}
