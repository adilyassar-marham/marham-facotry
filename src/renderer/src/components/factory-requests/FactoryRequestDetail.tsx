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
  const deciding =
    request.brief?.status === 'draft' ||
    request.pendingQuestion !== null ||
    request.planApproval === 'awaiting'

  return (
    <div className="flex h-full min-h-0 flex-col">
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
        <div className="flex flex-wrap gap-2">
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
          {finished || deciding ? null : (
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void window.api.factoryRequests.cancel({ requestId: request.id }).then(onChanged)
              }
            >
              {translate('auto.components.factoryRequests.detail.cancel', 'Stop this')}
            </Button>
          )}
        </div>
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
