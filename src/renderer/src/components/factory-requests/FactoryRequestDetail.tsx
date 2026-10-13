import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'
import { FactoryOpenPrDialog, type FactoryOpenPrTarget } from '../settings/FactoryOpenPrDialog'
import { FactoryRunSection } from '../settings/FactoryRunSection'
import {
  FactoryBriefCard,
  FactoryPlanApprovalCard,
  FactoryQuestionCard
} from './FactoryRequestActions'
import { factoryRequestChat, factoryRequestStatusText } from './factory-request-chat'
import {
  FACTORY_REQUEST_STAGE_TONE,
  factoryRequestAgeLabel,
  factoryRequestAgentLabel,
  factoryRequestIsFinished,
  factoryRequestStageLabel,
  factoryRequestStepIndex,
  factoryRequestStepLabels
} from './factory-request-presentation'

export function FactoryRequestDetail(props: {
  request: FactoryRequestView
  onChanged: () => void
  now: number
}): React.JSX.Element {
  const { request, onChanged, now } = props
  const [prTarget, setPrTarget] = useState<FactoryOpenPrTarget | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const report = request.report
  const finished = factoryRequestIsFinished(request.stage)
  const turns = factoryRequestChat(request)
  const stepIndex = factoryRequestStepIndex(request.stage)
  const working = FACTORY_REQUEST_STAGE_TONE[request.stage] === 'progress'
  const age = now > 0 ? factoryRequestAgeLabel(request.createdAt, now) : null
  const stop = (): void => {
    void window.api.factoryRequests.cancel({ requestId: request.id }).then(onChanged)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1" role="status">
            <p className="truncate text-sm font-medium text-foreground">{request.title}</p>
            <p className="flex items-start gap-2 text-sm text-foreground">
              {working ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" /> : null}
              <span>
                {factoryRequestStatusText(request, now > 0 ? now : Date.parse(request.createdAt))}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {translate('auto.components.factoryRequests.detail.using', 'Using {{value0}}', {
                value0: factoryRequestAgentLabel(request.agent)
              })}
              {' · '}
              {factoryRequestStageLabel(request.stage)}
              {age ? ` · ${age}` : ''}
            </p>
          </div>
          {finished ? null : (
            <Button variant="outline" size="sm" onClick={stop}>
              {translate('auto.components.factoryRequests.detail.cancel', 'Stop')}
            </Button>
          )}
        </div>
        {stepIndex === null ? null : (
          <ol className="flex flex-wrap gap-x-3 gap-y-1">
            {factoryRequestStepLabels().map((label, index) => (
              <li
                key={label}
                data-state={index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'later'}
                className="text-xs text-muted-foreground data-[state=current]:font-medium data-[state=current]:text-foreground data-[state=done]:text-foreground"
              >
                {index + 1}. {label}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {turns.map((turn) => (
          <div key={turn.id} data-role={turn.role} className="flex data-[role=you]:justify-end">
            <div
              data-role={turn.role}
              className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm leading-snug whitespace-pre-wrap text-foreground data-[role=you]:bg-accent"
            >
              {turn.text}
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 space-y-3 border-t border-border pt-3">
        <FactoryBriefCard request={request} onChanged={onChanged} />
        <FactoryQuestionCard
          key={request.pendingQuestion?.id}
          request={request}
          onChanged={onChanged}
        />
        <FactoryPlanApprovalCard request={request} onChanged={onChanged} />
        {request.stage === 'ready_for_pr' && request.runId && report?.integrationBranch ? (
          <Button
            className="w-full"
            onClick={() =>
              setPrTarget({
                runId: request.runId ?? '',
                integrationBranch: report.integrationBranch ?? '',
                baseBranch: report.baseBranch,
                defaultTitle: request.title
              })
            }
          >
            {translate('auto.components.factoryRequests.detail.send', 'Send to engineers')}
          </Button>
        ) : null}
        {report?.pullRequest ? (
          <Button
            variant="outline"
            onClick={() =>
              report.pullRequest ? void window.api.shell.openUrl(report.pullRequest.url) : undefined
            }
          >
            {translate('auto.components.factoryRequests.detail.viewPr', 'Open what we sent')}
          </Button>
        ) : null}
        {report && request.runId ? (
          <Button size="xs" variant="ghost" onClick={() => setShowDetails((value) => !value)}>
            {showDetails
              ? translate(
                  'auto.components.factoryRequests.detail.hideDetails',
                  'Hide technical details'
                )
              : translate(
                  'auto.components.factoryRequests.detail.details',
                  'Show technical details'
                )}
          </Button>
        ) : null}
      </div>
      {showDetails && report && request.runId ? (
        <FactoryRunSection
          runId={request.runId}
          objective={request.title}
          report={report}
          onChanged={onChanged}
        />
      ) : null}
      <FactoryOpenPrDialog
        key={prTarget?.runId ?? 'closed'}
        target={prTarget}
        onClose={(opened) => {
          setPrTarget(null)
          if (opened) {
            onChanged()
          }
        }}
      />
    </div>
  )
}
