import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { translate } from '@/i18n/i18n'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import type { FactoryGateStatus } from '../../../../shared/factory-types'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'

/** Starts a request: records it, then launches its coordinator agent in a fresh workspace. */
export function FactoryRequestForm(props: {
  gates: FactoryGateStatus[]
  onCreated: (requestId: string) => void
  onGatesChanged: () => void
}): React.JSX.Element {
  const { gates, onCreated, onGatesChanged } = props
  const settings = useAppStore((s) => s.settings)
  const detected = useDetectedAgents(null)
  const projects = gates.filter((gate) => gate.enabled && !gate.stale)
  const [chosenRepoId, setRepoId] = useState<string>('')
  // Why derived: projects appear while the form is open (a gate turned on), so state can lag.
  const repoId = projects.some((project) => project.repoId === chosenRepoId)
    ? chosenRepoId
    : (projects[0]?.repoId ?? '')
  const defaultAgent = settings?.defaultTuiAgent
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agents = useMemo(
    () =>
      getAgentCatalog().filter(
        (entry) =>
          (detected.detectedIds ?? []).includes(entry.id) &&
          isTuiAgentEnabled(entry.id, settings?.disabledTuiAgents)
      ),
    [detected.detectedIds, settings?.disabledTuiAgents]
  )

  const chosenAgent =
    defaultAgent && defaultAgent !== 'blank' ? defaultAgent : (agents[0]?.id ?? null)
  const start = async (): Promise<void> => {
    const message = description.trim()
    const titleFromMessage = message.split('\n')[0]?.trim().slice(0, 120) ?? ''
    if (!chosenAgent || !repoId || !titleFromMessage) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Main records the request and launches its coordinator as one step, rolling back on failure.
      const created = await window.api.factoryRequests.create({
        repoId,
        title: titleFromMessage,
        description: message,
        agent: chosenAgent
      })
      onCreated(created.requestId)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError))
    } finally {
      setBusy(false)
    }
  }

  if (projects.length === 0) {
    const withTeamRules = gates.filter((gate) => gate.teamRules !== null)
    return (
      <div className="space-y-3">
        <p className="text-[13px] leading-snug text-muted-foreground">
          {withTeamRules.length > 0
            ? translate(
                'auto.components.factoryRequests.form.useTeamRules',
                'Turn on your team’s rules for a project to start making requests. They come from the project’s main branch, set by your engineers.'
              )
            : translate(
                'auto.components.factoryRequests.form.noProjects',
                'No project is ready for requests yet. An engineer needs to turn on the quality gate in Settings → Orchestration → Software factory.'
              )}
        </p>
        {withTeamRules.map((gate) => (
          <Button
            key={gate.repoId}
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              void window.api.factoryGate
                .enableManaged({ repoId: gate.repoId })
                .then(onGatesChanged)
                .catch((enableError: unknown) =>
                  setError(enableError instanceof Error ? enableError.message : String(enableError))
                )
                .finally(() => setBusy(false))
            }}
          >
            {translate(
              'auto.components.factoryRequests.form.turnOn',
              'Use team rules for {{value0}}',
              {
                value0: gate.repoName
              }
            )}
          </Button>
        ))}
        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      </div>
    )
  }

  const examples = [
    translate(
      'auto.components.factoryRequests.form.exampleDoctors',
      'Let patients save doctors they like'
    ),
    translate(
      'auto.components.factoryRequests.form.exampleFee',
      'Show the doctor fee on the booking screen'
    ),
    translate(
      'auto.components.factoryRequests.form.exampleDiscount',
      'Make the discount easier to see'
    )
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm font-medium text-foreground">
          {translate(
            'auto.components.factoryRequests.form.greeting',
            'What do you want to change?'
          )}
        </p>
        <p className="max-w-sm text-xs text-balance text-muted-foreground">
          {translate(
            'auto.components.factoryRequests.form.hint',
            'Tell me in your own words. I’ll ask a couple of questions before I build anything.'
          )}
        </p>
        <div className="flex w-full max-w-md flex-col gap-2">
          {examples.map((example) => (
            <Button
              key={example}
              variant="outline"
              className="h-auto justify-start text-left whitespace-normal"
              onClick={() => setDescription(example)}
            >
              {example}
            </Button>
          ))}
        </div>
        {projects.length > 1 ? (
          <div className="flex flex-wrap justify-center gap-2">
            {projects.map((project) => (
              <Button
                key={project.repoId}
                size="xs"
                variant={project.repoId === repoId ? 'default' : 'outline'}
                onClick={() => setRepoId(project.repoId)}
              >
                {project.repoName}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="space-y-2 border-t border-border p-3">
        <Textarea
          id="factory-request-description"
          rows={3}
          value={description}
          placeholder={translate(
            'auto.components.factoryRequests.form.detailsPlaceholder',
            'Tell me what you want, the way you’d tell a coworker.'
          )}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && description.trim() && !busy) {
              event.preventDefault()
              void start()
            }
          }}
        />
        {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        {!chosenAgent ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.factoryRequests.form.noHelper',
              'This computer doesn’t have a helper installed yet. Ask an engineer.'
            )}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button
            disabled={busy || !chosenAgent || !description.trim()}
            onClick={() => void start()}
          >
            {busy
              ? translate('auto.components.factoryRequests.form.starting', 'Starting…')
              : translate('auto.components.factoryRequests.form.start', 'Send')}
          </Button>
        </div>
      </div>
    </div>
  )
}
