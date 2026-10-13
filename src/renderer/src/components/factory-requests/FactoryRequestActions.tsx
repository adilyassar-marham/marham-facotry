import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { NativeChatMarkdown } from '@/components/native-chat/NativeChatMarkdown'
import { translate } from '@/i18n/i18n'
import type { FactoryBriefKind, FactoryRequestView } from '../../../../shared/factory-request-types'

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
  const [other, setOther] = useState(false)
  const { busy, error, submit } = useSubmit(props.onChanged)
  if (!question) {
    return null
  }
  const choices = question.choices ?? []
  const send = (text: string): void => {
    void submit(() => window.api.factoryRequests.answer({ questionId: question.id, answer: text }))
  }
  if (choices.length > 0 && !other) {
    return (
      <div className="space-y-2">
        <div className="flex flex-col gap-2">
          {choices.map((choice, index) => (
            <Button
              key={choice}
              variant={question.recommended === index + 1 ? 'default' : 'outline'}
              className="h-auto w-full justify-start text-left whitespace-normal"
              disabled={busy}
              onClick={() => send(choice)}
            >
              {choice}
              {question.recommended === index + 1
                ? ` · ${translate('auto.components.factoryRequests.question.suggested', 'Suggested')}`
                : ''}
            </Button>
          ))}
        </div>
        {question.why ? <p className="text-xs text-muted-foreground">{question.why}</p> : null}
        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setOther(true)}>
          {translate('auto.components.factoryRequests.question.other', 'Something else')}
        </Button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <Textarea
        rows={3}
        value={answer}
        placeholder={translate(
          'auto.components.factoryRequests.question.placeholder',
          'Reply in your own words'
        )}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && answer.trim()) {
            event.preventDefault()
            send(answer.trim())
          }
        }}
      />
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      <Button size="xs" disabled={busy || !answer.trim()} onClick={() => send(answer.trim())}>
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
  const notes = feedback.trim()
  return (
    <div className="space-y-3">
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
      <div className="flex flex-col gap-2">
        <Button
          disabled={busy || (askingChanges && !notes)}
          onClick={() =>
            void submit(() =>
              window.api.factoryRequests.decidePlan(
                askingChanges ? { runId, approve: true, feedback: notes } : { runId, approve: true }
              )
            )
          }
        >
          {translate('auto.components.factoryRequests.plan.approve', 'Go ahead')}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setAskingChanges((value) => !value)}
        >
          {askingChanges
            ? translate('auto.components.factoryRequests.plan.back', 'Back')
            : translate('auto.components.factoryRequests.plan.changes', 'Change something')}
        </Button>
      </div>
    </div>
  )
}

function briefKindLabel(kind: FactoryBriefKind): string {
  switch (kind) {
    case 'app_only':
      return translate(
        'auto.components.factoryRequests.brief.kindApp',
        'This is a change in the app.'
      )
    case 'needs_backend':
      return translate(
        'auto.components.factoryRequests.brief.kindBackend',
        'This needs the server team. I won’t change the app.'
      )
    case 'app_and_backend':
      return translate(
        'auto.components.factoryRequests.brief.kindBoth',
        'I’ll change the app, and the server team has a part too.'
      )
    case 'needs_native':
      return translate(
        'auto.components.factoryRequests.brief.kindNative',
        'This needs a change in the phone system itself.'
      )
    case 'not_feasible':
      return translate(
        'auto.components.factoryRequests.brief.kindNo',
        'I can’t do this one. Here’s why, and what we could do instead.'
      )
  }
}

/** The plain brief. Nothing is built until the person says it looks right. */
export function FactoryBriefCard(props: {
  request: FactoryRequestView
  onChanged: () => void
}): React.JSX.Element | null {
  const brief = props.request.brief
  const [feedback, setFeedback] = useState('')
  const [askingChanges, setAskingChanges] = useState(false)
  const { busy, error, submit } = useSubmit(props.onChanged)
  if (!brief || brief.status !== 'draft') {
    return null
  }
  const notes = feedback.trim()
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <NativeChatMarkdown content={brief.person} />
      <p className="text-xs text-muted-foreground">{briefKindLabel(brief.kind)}</p>
      {askingChanges ? (
        <Textarea
          rows={3}
          value={feedback}
          placeholder={translate(
            'auto.components.factoryRequests.brief.feedbackPlaceholder',
            'What should be different?'
          )}
          onChange={(event) => setFeedback(event.target.value)}
        />
      ) : null}
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      <div className="flex flex-col gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            void submit(() =>
              window.api.factoryRequests.decideBrief({
                requestId: props.request.id,
                approve: true
              })
            )
          }
        >
          {translate('auto.components.factoryRequests.brief.approve', 'Looks good, build it')}
        </Button>
        {askingChanges ? (
          <Button
            size="xs"
            disabled={busy || !notes}
            onClick={() =>
              void submit(() =>
                window.api.factoryRequests.decideBrief({
                  requestId: props.request.id,
                  approve: false,
                  feedback: notes
                })
              )
            }
          >
            {translate('auto.components.factoryRequests.brief.sendChange', 'Update the brief')}
          </Button>
        ) : (
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => setAskingChanges(true)}
          >
            {translate('auto.components.factoryRequests.brief.change', 'Change something')}
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void submit(() => window.api.factoryRequests.cancel({ requestId: props.request.id }))
          }
        >
          {translate('auto.components.factoryRequests.brief.cancel', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}
