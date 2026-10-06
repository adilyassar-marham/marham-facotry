import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { FactoryBoard, FactoryBoardTask } from '../../../../shared/factory-types'
import { FACTORY_STAGE_TONE, factoryStageLabel } from './factory-stage-presentation'
import { FactoryRunSection } from './FactoryRunSection'

const POLL_MS = 5_000

function verifyNote(task: FactoryBoardTask): string | null {
  const verify = task.verify
  if (!verify || verify.status === 'running' || verify.status === 'passed') {
    return null
  }
  return verify.status === 'failed'
    ? translate('auto.components.settings.FactoryBoard.verifyExit', 'verify exit {{value0}}', {
        value0: verify.exitCode ?? '?'
      })
    : verify.status === 'not_approved'
      ? translate('auto.components.settings.FactoryBoard.verifyNotApproved', 'verify not approved')
      : translate('auto.components.settings.FactoryBoard.verifyError', 'verify could not run')
}

export function FactoryBoardSection(): React.JSX.Element {
  const [board, setBoard] = useState<FactoryBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const next = await callRuntimeRpc<FactoryBoard>({ kind: 'local' }, 'factory.board', {})
        if (!cancelled) {
          setBoard(next)
          setError(null)
        }
      } catch (loadError) {
        // Why keep the last board: a transient failure should not blank a board mid-run.
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [tick])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-[13px] font-medium text-foreground">
          {translate('auto.components.settings.FactoryBoard.title', 'Factory board')}
          {board?.runId ? (
            <span className="ml-2 font-mono text-[12px] font-normal text-muted-foreground">
              {board.runId}
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('auto.components.settings.FactoryBoard.refresh', 'Refresh board')}
          onClick={() => setTick((value) => value + 1)}
        >
          <RefreshCw />
        </Button>
      </div>
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
      {board && board.tasks.length > 0 ? (
        <div className="divide-y divide-border rounded-md border border-border">
          {board.tasks.map((task) => (
            <div key={task.taskId} className="flex items-center gap-3 px-3 py-2">
              <span
                data-tone={FACTORY_STAGE_TONE[task.stage]}
                className="w-24 shrink-0 rounded-full border border-border px-2 py-0.5 text-center text-[11px] font-medium text-muted-foreground data-[tone=progress]:text-foreground data-[tone=success]:border-status-success-border data-[tone=success]:bg-status-success-background data-[tone=success]:text-status-success data-[tone=warning]:border-status-warning-border data-[tone=warning]:bg-status-warning-background data-[tone=warning]:text-status-warning data-[tone=danger]:border-destructive data-[tone=danger]:text-destructive"
              >
                {factoryStageLabel(task.stage)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-foreground">{task.title}</div>
                <div className="truncate font-mono text-[12px] text-muted-foreground">
                  {task.taskId}
                  {task.kind === 'review'
                    ? ` · ${translate('auto.components.settings.FactoryBoard.reviewTask', 'reviewer')}`
                    : ''}
                  {verifyNote(task) ? ` · ${verifyNote(task)}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {board?.runId && board.report ? (
        <FactoryRunSection
          runId={board.runId}
          objective={board.objective}
          report={board.report}
          onChanged={() => setTick((value) => value + 1)}
        />
      ) : null}
      {board && board.tasks.length === 0 ? (
        <p className="text-[12px] leading-snug text-muted-foreground">
          {translate(
            'auto.components.settings.FactoryBoard.empty',
            'No factory run yet. Ask a coordinator agent: “Use the factory skill to plan and build <your goal>.”'
          )}
        </p>
      ) : null}
    </div>
  )
}
