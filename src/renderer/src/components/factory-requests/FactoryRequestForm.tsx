import { useMemo, useState } from 'react'
import AgentCombobox from '@/components/agent/AgentCombobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { translate } from '@/i18n/i18n'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import type { AgentLaunchResult } from '../../../../shared/agent-launch-intent'
import type { FactoryGateStatus } from '../../../../shared/factory-types'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../shared/tui-agent'

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
  const [agent, setAgent] = useState<TuiAgent | null>(
    defaultAgent && defaultAgent !== 'blank' ? defaultAgent : null
  )
  const [title, setTitle] = useState('')
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

  const start = async (): Promise<void> => {
    if (!agent || !repoId) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await window.api.factoryRequests.create({
        repoId,
        title,
        description,
        agent
      })
      const launched = await callRuntimeRpc<AgentLaunchResult>({ kind: 'local' }, 'agent.launch', {
        agent,
        target: {
          kind: 'create-worktree',
          create: { repo: `id:${repoId}`, name: created.workspaceName }
        },
        prompt: { text: created.coordinatorPrompt, delivery: 'submit' }
      })
      await window.api.factoryRequests.attachWorktree({
        requestId: created.requestId,
        worktreeId: launched.worktreeId
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

  return (
    <div className="space-y-4">
      {projects.length > 1 ? (
        <div className="space-y-1.5">
          <Label>{translate('auto.components.factoryRequests.form.project', 'Project')}</Label>
          <div className="flex flex-wrap gap-2">
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
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="factory-request-title">
          {translate('auto.components.factoryRequests.form.title', 'What should change?')}
        </Label>
        <Input
          id="factory-request-title"
          value={title}
          maxLength={120}
          placeholder={translate(
            'auto.components.factoryRequests.form.titlePlaceholder',
            'e.g. Show the doctor’s fee on the booking screen'
          )}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="factory-request-description">
          {translate('auto.components.factoryRequests.form.details', 'Details')}
        </Label>
        <Textarea
          id="factory-request-description"
          rows={7}
          value={description}
          placeholder={translate(
            'auto.components.factoryRequests.form.detailsPlaceholder',
            'Which screen, what users should see, and why. Plain words are perfect.'
          )}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>{translate('auto.components.factoryRequests.form.agent', 'AI agent')}</Label>
        <AgentCombobox
          agents={agents}
          value={agent}
          onValueChange={setAgent}
          allowNarrowTrigger
          triggerClassName="w-full"
        />
      </div>
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      <Button
        disabled={busy || !agent || !title.trim() || !description.trim()}
        onClick={() => void start()}
      >
        {busy
          ? translate('auto.components.factoryRequests.form.starting', 'Starting…')
          : translate('auto.components.factoryRequests.form.start', 'Start request')}
      </Button>
    </div>
  )
}
