import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type {
  FactoryCheckSummary,
  FactoryCleanupResult,
  FactoryRunReport
} from '../../../../shared/factory-run-types'
import { FactoryOpenPrDialog, type FactoryOpenPrTarget } from './FactoryOpenPrDialog'

type Tone = 'neutral' | 'success' | 'danger'

function checkTone(check: FactoryCheckSummary | null): Tone {
  return !check ? 'neutral' : check.status === 'passed' ? 'success' : 'danger'
}

function checkLabel(check: FactoryCheckSummary | null): string {
  if (!check) {
    return translate('auto.components.settings.FactoryRunSection.notRun', 'Not run')
  }
  return check.status === 'passed'
    ? translate('auto.components.settings.FactoryRunSection.passed', 'Passed at {{value0}}', {
        value0: check.headSha.slice(0, 8)
      })
    : translate('auto.components.settings.FactoryRunSection.failed', 'Failed at {{value0}}', {
        value0: check.headSha.slice(0, 8)
      })
}

function StatusRow(props: { label: string; value: string; tone: Tone }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5">
      <span className="w-36 shrink-0 text-[12px] text-muted-foreground">{props.label}</span>
      <span
        data-tone={props.tone}
        className="min-w-0 flex-1 truncate text-[12px] text-foreground data-[tone=danger]:text-destructive data-[tone=success]:text-status-success"
      >
        {props.value}
      </span>
    </div>
  )
}

/** Run-level factory state: whole-branch checks, review rounds, and the person's PR decision. */
export function FactoryRunSection(props: {
  runId: string
  objective: string | null
  report: FactoryRunReport
  onChanged: () => void
}): React.JSX.Element {
  const { runId, objective, report, onChanged } = props
  const [prTarget, setPrTarget] = useState<FactoryOpenPrTarget | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const review = report.reviews.at(-1) ?? null

  const cleanup = async (): Promise<void> => {
    setCleaning(true)
    try {
      const result = await callRuntimeRpc<FactoryCleanupResult>(
        { kind: 'local' },
        'factory.cleanup',
        {
          run: runId
        }
      )
      toast.success(
        translate(
          'auto.components.settings.FactoryRunSection.cleaned',
          'Removed {{value0}} worktree(s), kept {{value1}}.',
          { value0: result.removed.length, value1: result.kept.length }
        )
      )
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setCleaning(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="divide-y divide-border rounded-md border border-border">
        <StatusRow
          label={translate(
            'auto.components.settings.FactoryRunSection.branch',
            'Integration branch'
          )}
          value={report.integrationBranch ?? '—'}
          tone="neutral"
        />
        <StatusRow
          label={translate('auto.components.settings.FactoryRunSection.baseline', 'Baseline')}
          value={checkLabel(report.baseline)}
          tone={checkTone(report.baseline)}
        />
        <StatusRow
          label={translate(
            'auto.components.settings.FactoryRunSection.integration',
            'Combined verify'
          )}
          value={checkLabel(report.integration)}
          tone={checkTone(report.integration)}
        />
        <StatusRow
          label={translate('auto.components.settings.FactoryRunSection.review', 'Guideline review')}
          value={
            review
              ? translate(
                  'auto.components.settings.FactoryRunSection.reviewRound',
                  'Round {{value0}}: {{value1}} · fix rounds {{value2}}/{{value3}}',
                  {
                    value0: review.round,
                    value1: review.verdict,
                    value2: report.fixRoundsUsed,
                    value3: report.maxFixRounds
                  }
                )
              : translate('auto.components.settings.FactoryRunSection.noReview', 'Not started')
          }
          tone={
            !review || review.verdict === 'pending'
              ? 'neutral'
              : review.verdict === 'pass'
                ? 'success'
                : 'danger'
          }
        />
        <StatusRow
          label={translate('auto.components.settings.FactoryRunSection.refusals', 'Gate refusals')}
          value={String(report.gateRefusals)}
          tone="neutral"
        />
      </div>
      {review && review.verdict === 'fail' && review.findings.length > 0 ? (
        <ul className="space-y-1 text-[12px] text-muted-foreground">
          {review.findings.slice(0, 5).map((finding, index) => (
            <li key={`${finding.rule}-${index}`} className="truncate">
              {`[${finding.rule}] ${finding.file ? `${finding.file}: ` : ''}${finding.problem}`}
            </li>
          ))}
        </ul>
      ) : null}
      {report.skills.length > 0 ? (
        <ul className="space-y-1 text-[12px] text-muted-foreground">
          {report.skills.map((skill) => (
            <li key={`${skill.stage}-${skill.skill}`} className="truncate">
              {translate(
                'auto.components.settings.FactoryRunSection.skill',
                '{{value0}}: {{value1}} @ {{value2}}',
                {
                  value0: skill.stage,
                  value1: skill.skill,
                  value2: skill.pinnedCommit.slice(0, 8)
                }
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {report.pullRequest ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              report.pullRequest ? void window.api.shell.openUrl(report.pullRequest.url) : undefined
            }
          >
            {translate('auto.components.settings.FactoryRunSection.viewPr', 'View PR')}
          </Button>
        ) : (
          <Button
            size="xs"
            disabled={!report.prReadiness.ready || !report.integrationBranch}
            onClick={() =>
              setPrTarget({
                runId,
                integrationBranch: report.integrationBranch ?? '',
                baseBranch: report.baseBranch,
                defaultTitle: (objective ?? runId).split('\n')[0].slice(0, 72)
              })
            }
          >
            {translate('auto.components.settings.FactoryRunSection.openPr', 'Open draft PR')}
          </Button>
        )}
        <Button variant="ghost" size="xs" disabled={cleaning} onClick={() => void cleanup()}>
          {translate('auto.components.settings.FactoryRunSection.cleanup', 'Clean up worktrees')}
        </Button>
      </div>
      {!report.pullRequest && !report.prReadiness.ready ? (
        <ul className="space-y-0.5 text-[12px] leading-snug text-muted-foreground">
          {report.prReadiness.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
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
