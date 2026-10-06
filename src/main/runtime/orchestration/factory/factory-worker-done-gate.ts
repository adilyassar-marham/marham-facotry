import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import type { FactoryVerifyResultRow } from '../db/factory/factory-row-types'
import type { FactoryGitRunner } from './factory-git'
import { recordFactoryReviewFromWorkerDone } from './factory-review-report'
import {
  runFactoryVerify,
  type FactoryScriptRunner,
  type FactoryVerifyHost
} from './factory-verify'

function describeFailure(
  taskId: string,
  command: string | undefined,
  result: FactoryVerifyResultRow
): string {
  const seconds = Math.round((result.duration_ms ?? 0) / 1000)
  const verdict =
    result.status === 'failed' && result.exit_code === null
      ? 'uncommitted work'
      : result.status === 'failed'
        ? `exit ${result.exit_code}, ${seconds}s`
        : result.timed_out
          ? `timed out after ${seconds}s`
          : result.status === 'not_approved'
            ? 'verify command not approved'
            : 'verify could not run'
  const next =
    result.status === 'not_approved' || result.status === 'error'
      ? 'This needs a person, not a code change. Report --outcome failed with this message if it persists.'
      : 'The task stays open. Fix the failures below in this worktree, then send worker_done ' +
        '--outcome succeeded again. If you cannot fix them, send worker_done --outcome failed ' +
        'with a summary instead.'
  return [
    `Factory quality gate refused task ${taskId} (${verdict})${command ? `: \`${command}\`` : ''}.`,
    next,
    '--- verify output (tail) ---',
    result.output_tail
  ].join('\n')
}

/**
 * Runs before the worker-report commit, which holds the SQLite writer lock and cannot await a
 * test suite. A pass leaves a ticket the commit spends; anything else refuses the report here.
 */
export async function enforceFactoryGateBeforeWorkerSuccess(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  params: { dispatchId: string; outcome: unknown; reportPath?: unknown },
  runner?: FactoryScriptRunner,
  git?: FactoryGitRunner
): Promise<void> {
  const dispatch = db.getDispatchContextById(params.dispatchId)
  if (!dispatch) {
    return
  }
  const isReview = await recordFactoryReviewFromWorkerDone(db, host, {
    dispatchId: params.dispatchId,
    taskId: dispatch.task_id,
    outcome: params.outcome,
    reportPath: params.reportPath
  })
  if (isReview || params.outcome !== 'succeeded') {
    return
  }
  const outcome = await runFactoryVerify(
    db,
    host,
    { taskId: dispatch.task_id, dispatchId: params.dispatchId },
    runner,
    git
  )
  if (!outcome.gated || outcome.result.status === 'passed') {
    return
  }
  throw new OrchestrationError(
    'factory_verify_failed',
    describeFailure(dispatch.task_id, outcome.command, outcome.result),
    {
      taskId: dispatch.task_id,
      dispatchId: params.dispatchId,
      verifyId: outcome.result.id,
      status: outcome.result.status,
      exitCode: outcome.result.exit_code
    }
  )
}
