import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'

function useSubmit(onDone: () => void): {
  busy: boolean
  error: string | null
  submit: (action: () => Promise<void>) => Promise<void>
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onDone()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, submit }
}

/** The agent's question, answered in plain words; the coordinator is waiting on it. */
export function FactoryQuestionCard(props: {
  request: FactoryRequestView
  onChanged: () => void
}): React.JSX.Element | null {
  const question = props.request.pendingQuestion
  const [answer, setAnswer] = useState('')
  const { busy, error, submit } = useSubmit(props.onChanged)
  if (!question) {
    return null
  }
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="text-[13px] font-medium text-foreground">{question.question}</div>
      <Textarea rows={3} value={answer} onChange={(event) => setAnswer(event.target.value)} />
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      <Button
        size="xs"
        disabled={busy || !answer.trim()}
        onClick={() =>
          void submit(() =>
            window.api.factoryRequests.answer({ questionId: question.id, answer: answer.trim() })
          )
        }
      >
        {translate('auto.components.factoryRequests.question.send', 'Send answer')}
      </Button>
    </div>
  )
}

/** The plan in the requester's terms; nothing is built until they approve it. */
export function FactoryPlanApprovalCard(props: {
  request: FactoryRequestView
  onChanged: () => void
}): React.JSX.Element | null {
  const { request } = props
  const [feedback, setFeedback] = useState('')
  const [askingChanges, setAskingChanges] = useState(false)
  const { busy, error, submit } = useSubmit(props.onChanged)
  if (request.planApproval !== 'awaiting' || !request.runId) {
    return null
  }
  const runId = request.runId
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="text-[13px] font-medium text-foreground">
        {translate(
          'auto.components.factoryRequests.plan.title',
          'Here is the plan. Nothing is built until you approve it.'
        )}
      </div>
      <ol className="space-y-2">
        {request.plan.map((task, index) => (
          <li key={task.taskId} className="text-[12px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">{`${index + 1}. ${task.title}`}</span>
            <div className="line-clamp-3 whitespace-pre-wrap">{task.spec}</div>
          </li>
        ))}
      </ol>
      {askingChanges ? (
        <Textarea
          rows={3}
          value={feedback}
          placeholder={translate(
            'auto.components.factoryRequests.plan.feedbackPlaceholder',
            'What should be different?'
          )}
          onChange={(event) => setFeedback(event.target.value)}
        />
      ) : null}
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        {askingChanges ? (
          <Button
            size="xs"
            disabled={busy || !feedback.trim()}
            onClick={() =>
              void submit(() =>
                window.api.factoryRequests.decidePlan({
                  runId,
                  approve: false,
                  feedback: feedback.trim()
                })
              )
            }
          >
            {translate('auto.components.factoryRequests.plan.sendChanges', 'Send changes')}
          </Button>
        ) : (
          <Button
            size="xs"
            disabled={busy}
            onClick={() =>
              void submit(() => window.api.factoryRequests.decidePlan({ runId, approve: true }))
            }
          >
            {translate('auto.components.factoryRequests.plan.approve', 'Approve plan')}
          </Button>
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={busy}
          onClick={() => setAskingChanges((value) => !value)}
        >
          {askingChanges
            ? translate('auto.components.factoryRequests.plan.back', 'Back')
            : translate('auto.components.factoryRequests.plan.changes', 'Ask for changes')}
        </Button>
      </div>
    </div>
  )
}
