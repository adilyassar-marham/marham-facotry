import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { translate } from '@/i18n/i18n'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import type { FactoryGateStatus } from '../../../../shared/factory-types'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'
import {
  factoryAutomaticHelper,
  factoryHelperHasAccountSignIn,
  factoryHelperIsIntegrated,
  factoryHelperLabel
} from './factory-helper-choice'

/** Starts a request: records it, then launches its coordinator agent in a fresh workspace. */
export function FactoryRequestForm(props: {
  gates: FactoryGateStatus[]
  signedInIds: string[] | null
  onCreated: (requestId: string) => void
  onGatesChanged: () => void
  onSendStarted?: () => void
  onSignedIn?: () => void
  onOpenAccounts?: (sectionId: string) => void
}): React.JSX.Element {
  const {
    gates,
    signedInIds,
    onCreated,
    onGatesChanged,
    onSendStarted,
    onSignedIn,
    onOpenAccounts
  } = props
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const fetchSettings = useAppStore((s) => s.fetchSettings)
  const detected = useDetectedAgents(null)
  const projects = gates.filter((gate) => gate.enabled && !gate.stale)
  const [chosenRepoId, setRepoId] = useState<string>('')
  // Why derived: projects appear while the form is open (a gate turned on), so state can lag.
  const repoId = projects.some((project) => project.repoId === chosenRepoId)
    ? chosenRepoId
    : (projects[0]?.repoId ?? '')
  const defaultAgent = settings?.defaultTuiAgent
  const [pickedAgent, setPickedAgent] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agents = useMemo(
    () =>
      getAgentCatalog().filter(
        (entry) =>
          factoryHelperHasAccountSignIn(entry.id) &&
          (detected.detectedIds ?? []).includes(entry.id) &&
          isTuiAgentEnabled(entry.id, settings?.disabledTuiAgents)
      ),
    [detected.detectedIds, settings?.disabledTuiAgents]
  )

  const managed = {
    claude: Boolean(settings?.activeClaudeManagedAccountId),
    codex: Boolean(settings?.activeCodexManagedAccountId)
  }
  const signedIn = signedInIds ?? []
  const readyAgents = agents.filter((agent) =>
    factoryHelperIsIntegrated(agent.id, signedIn, managed)
  )
  const chosenAgent = factoryAutomaticHelper(
    pickedAgent ?? defaultAgent,
    agents.map((agent) => agent.id),
    signedIn,
    managed
  )
  const needsSignIn = signedInIds !== null && readyAgents.length === 0 && chosenAgent !== null
  const start = async (): Promise<void> => {
    const message = description.trim()
    const titleFromMessage = message.split('\n')[0]?.trim().slice(0, 120) ?? ''
    if (!chosenAgent || !repoId || !titleFromMessage || needsSignIn) {
      return
    }
    setBusy(true)
    setError(null)
    onSendStarted?.()
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
  const signIn = async (agent: string): Promise<void> => {
    if (signingIn) {
      return
    }
    setPickedAgent(agent)
    if (agent === 'cursor') {
      onOpenAccounts?.('accounts-cursor')
      return
    }
    if (agent !== 'claude' && agent !== 'codex') {
      return
    }
    setSigningIn(true)
    setError(null)
    try {
      await (agent === 'claude' ? window.api.claudeAccounts.add() : window.api.codexAccounts.add())
      await fetchSettings()
      onSignedIn?.()
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : String(signInError))
    } finally {
      setSigningIn(false)
    }
  }
  const cancelSignIn = (): void => {
    if (pickedAgent === 'codex') {
      void window.api.codexAccounts.cancelPendingLogin()
      return
    }
    void window.api.claudeAccounts.cancelPendingLogin()
  }
  const signInChoices =
    agents.filter((agent) => agent.id === 'claude' || agent.id === 'codex').length > 0
      ? agents.filter((agent) => agent.id === 'claude' || agent.id === 'codex')
      : agents

  if (projects.length === 0) {
    const withTeamRules = gates.filter((gate) => gate.teamRules !== null)
    return (
      <div className="space-y-3">
        <p className="text-[13px] leading-snug text-muted-foreground">
          {withTeamRules.length > 0
            ? translate(
                'auto.components.factoryRequests.form.useTeamRules',
                'Ask an engineer to turn this on. Then you can start.'
              )
            : translate(
                'auto.components.factoryRequests.form.noProjects',
                'This app isn’t ready for requests yet. Ask an engineer to turn it on.'
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
            {translate('auto.components.factoryRequests.form.turnOn', 'Turn on {{value0}}', {
              value0: gate.repoName
            })}
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
    <div className="scrollbar-sleek flex h-full min-h-0 items-center justify-center overflow-y-auto py-8">
      <div className="flex w-full max-w-xl flex-col gap-5">
        {busy ? (
          <div role="status" className="space-y-2 text-center">
            <p className="text-sm font-medium text-foreground">
              {translate(
                'auto.components.factoryRequests.form.sendingTitle',
                'Sending your message'
              )}
            </p>
            <p className="text-xs text-balance text-muted-foreground">
              {translate(
                'auto.components.factoryRequests.form.sending',
                'The helper is starting. This can take a minute. It will show in the list on the left — open it there if you want to stop it.'
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {translate(
                  'auto.components.factoryRequests.form.greeting',
                  'What do you want to change?'
                )}
              </p>
              <p className="text-xs text-balance text-muted-foreground">
                {translate(
                  'auto.components.factoryRequests.form.hint',
                  'Tell me in your own words. I’ll ask a couple of questions before I build anything.'
                )}
              </p>
            </div>
            <div className="flex flex-col gap-2 text-left">
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
        )}
        <div className="space-y-3">
          <Textarea
            id="factory-request-description"
            rows={3}
            disabled={busy}
            value={description}
            placeholder={translate(
              'auto.components.factoryRequests.form.detailsPlaceholder',
              'Tell me what you want, the way you’d tell a coworker.'
            )}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                description.trim() &&
                !busy &&
                !signingIn &&
                !needsSignIn
              ) {
                event.preventDefault()
                void start()
              }
            }}
          />
          {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
          {readyAgents.length > 0 && chosenAgent ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.factoryRequests.form.usingHelper',
                  'Using {{value0}}.',
                  {
                    value0: factoryHelperLabel(chosenAgent)
                  }
                )}
              </p>
              {readyAgents.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  {readyAgents
                    .filter((agent) => agent.id !== chosenAgent)
                    .map((agent) => (
                      <Button
                        key={agent.id}
                        size="xs"
                        variant="ghost"
                        disabled={busy || signingIn}
                        onClick={() => {
                          setPickedAgent(agent.id)
                          if (settings?.defaultTuiAgent !== agent.id) {
                            void updateSettings({ defaultTuiAgent: agent.id })
                          }
                        }}
                      >
                        {translate(
                          'auto.components.factoryRequests.form.useInstead',
                          'Use {{value0}} instead',
                          { value0: factoryHelperLabel(agent.id) }
                        )}
                      </Button>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {needsSignIn ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.factoryRequests.form.signInPrompt',
                  'Sign in once. I’ll remember it on this computer.'
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {signInChoices.map((agent) => (
                  <Button
                    key={agent.id}
                    size="xs"
                    variant="outline"
                    disabled={busy || signingIn}
                    onClick={() => void signIn(agent.id)}
                  >
                    {signingIn && pickedAgent === agent.id
                      ? translate('auto.components.factoryRequests.form.signingIn', 'Signing in…')
                      : translate(
                          'auto.components.factoryRequests.form.signInTo',
                          'Sign in to {{value0}}',
                          { value0: factoryHelperLabel(agent.id) }
                        )}
                  </Button>
                ))}
                {signingIn ? (
                  <Button size="xs" variant="ghost" onClick={cancelSignIn}>
                    {translate('auto.components.factoryRequests.form.cancelSignIn', 'Cancel')}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
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
              disabled={busy || signingIn || needsSignIn || !chosenAgent || !description.trim()}
              onClick={() => void start()}
            >
              {busy
                ? translate('auto.components.factoryRequests.form.starting', 'Starting…')
                : translate('auto.components.factoryRequests.form.start', 'Send')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
