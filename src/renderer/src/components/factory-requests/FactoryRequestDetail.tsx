import { useState } from 'react'
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
import { factoryRequestChat } from './factory-request-chat'
import {
  FACTORY_REQUEST_STAGE_TONE,
  factoryRequestStageLabel
} from './factory-request-presentation'

export function FactoryRequestDetail(props: {
  request: FactoryRequestView
  onChanged: () => void
}): React.JSX.Element {
  const { request, onChanged } = props
  const [prTarget, setPrTarget] = useState<FactoryOpenPrTarget | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const report = request.report
  const finished = ['pr_opened', 'cancelled'].includes(request.stage)
  const turns = factoryRequestChat(request)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end gap-2 px-1 pb-2">
        <span
          data-tone={FACTORY_REQUEST_STAGE_TONE[request.stage]}
          className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground data-[tone=action]:border-status-warning-border data-[tone=action]:bg-status-warning-background data-[tone=action]:text-status-warning data-[tone=danger]:border-destructive data-[tone=danger]:text-destructive data-[tone=progress]:text-foreground data-[tone=success]:border-status-success-border data-[tone=success]:bg-status-success-background data-[tone=success]:text-status-success"
        >
          {factoryRequestStageLabel(request.stage)}
        </span>
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
      <div className="scrollbar-sleek min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {turns.map((turn) => (
          <div key={turn.id} data-role={turn.role} className="flex data-[role=you]:justify-end">
            <div
              data-role={turn.role}
              className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap text-foreground data-[role=you]:bg-accent"
            >
              {turn.text}
            </div>
          </div>
        ))}
        <FactoryBriefCard request={request} onChanged={onChanged} />
        <FactoryQuestionCard
          key={request.pendingQuestion?.id}
          request={request}
          onChanged={onChanged}
        />
        <FactoryPlanApprovalCard request={request} onChanged={onChanged} />
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border px-1 pt-3">
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
