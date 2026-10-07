import { useState } from 'react'
import { Check, Circle, CircleDot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'
import { FactoryOpenPrDialog, type FactoryOpenPrTarget } from '../settings/FactoryOpenPrDialog'
import { FactoryRunSection } from '../settings/FactoryRunSection'
import { FactoryPlanApprovalCard, FactoryQuestionCard } from './FactoryRequestActions'
import {
  FACTORY_REQUEST_STAGE_TONE,
  factoryRequestStageLabel,
  factoryRequestStepIndex,
  factoryRequestSteps
} from './factory-request-presentation'

function StepList(props: { request: FactoryRequestView }): React.JSX.Element {
  const current = factoryRequestStepIndex(props.request.stage)
  return (
    <ol className="space-y-1.5">
      {factoryRequestSteps().map((label, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo'
        return (
          <li
            key={label}
            data-state={state}
            className="flex items-center gap-2 text-[13px] text-muted-foreground data-[state=current]:font-medium data-[state=current]:text-foreground data-[state=done]:text-foreground"
          >
            {state === 'done' ? (
              <Check className="size-4 text-status-success" />
            ) : state === 'current' ? (
              <CircleDot className="size-4" />
            ) : (
              <Circle className="size-4" />
            )}
            <span>{label}</span>
            {state === 'current' && props.request.progress ? (
              <span className="text-[12px] font-normal text-muted-foreground">
                {translate(
                  'auto.components.factoryRequests.detail.progress',
                  '{{value0}} of {{value1}} done',
                  { value0: props.request.progress.done, value1: props.request.progress.total }
                )}
              </span>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export function FactoryRequestDetail(props: {
  request: FactoryRequestView
  onChanged: () => void
}): React.JSX.Element {
  const { request, onChanged } = props
  const [prTarget, setPrTarget] = useState<FactoryOpenPrTarget | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const report = request.report
  const finished = ['pr_opened', 'cancelled'].includes(request.stage)

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 text-[15px] font-medium text-foreground">
            {request.title}
          </div>
          <span
            data-tone={FACTORY_REQUEST_STAGE_TONE[request.stage]}
            className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground data-[tone=action]:border-status-warning-border data-[tone=action]:bg-status-warning-background data-[tone=action]:text-status-warning data-[tone=danger]:border-destructive data-[tone=danger]:text-destructive data-[tone=progress]:text-foreground data-[tone=success]:border-status-success-border data-[tone=success]:bg-status-success-background data-[tone=success]:text-status-success"
          >
            {factoryRequestStageLabel(request.stage)}
          </span>
        </div>
        <p className="line-clamp-4 text-[12px] leading-snug whitespace-pre-wrap text-muted-foreground">
          {request.description}
        </p>
      </div>
      {request.stage === 'needs_engineer' ? (
        <p className="rounded-md border border-destructive px-3 py-2 text-[12px] text-destructive">
          {translate(
            'auto.components.factoryRequests.detail.needsEngineer',
            'The factory could not finish this on its own. Share this request with an engineer; the details below show where it stopped.'
          )}
        </p>
      ) : (
        <StepList request={request} />
      )}
      <FactoryQuestionCard
        key={request.pendingQuestion?.id}
        request={request}
        onChanged={onChanged}
      />
      <FactoryPlanApprovalCard request={request} onChanged={onChanged} />
      <div className="flex flex-wrap gap-2">
        {request.stage === 'ready_for_pr' && request.runId && report?.integrationBranch ? (
          <Button
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
            {translate('auto.components.factoryRequests.detail.viewPr', 'View pull request')}
          </Button>
        ) : null}
        {finished ? null : (
          <Button
            variant="ghost"
            onClick={() =>
              void window.api.factoryRequests.cancel({ requestId: request.id }).then(onChanged)
            }
          >
            {translate('auto.components.factoryRequests.detail.cancel', 'Cancel request')}
          </Button>
        )}
        {report && request.runId ? (
          <Button variant="ghost" onClick={() => setShowDetails((value) => !value)}>
            {showDetails
              ? translate('auto.components.factoryRequests.detail.hideDetails', 'Hide details')
              : translate(
                  'auto.components.factoryRequests.detail.details',
                  'Details for engineers'
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
