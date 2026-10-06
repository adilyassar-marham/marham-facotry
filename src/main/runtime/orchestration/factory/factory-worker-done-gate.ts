import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import type { FactoryVerifyResultRow } from '../db/factory/factory-row-types'
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
    result.status === 'failed'
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
  params: { dispatchId: string; outcome: unknown },
  runner?: FactoryScriptRunner
): Promise<void> {
  if (params.outcome !== 'succeeded') {
    return
  }
  const dispatch = db.getDispatchContextById(params.dispatchId)
  if (!dispatch) {
    return
  }
  const outcome = await runFactoryVerify(
    db,
    host,
    { taskId: dispatch.task_id, dispatchId: params.dispatchId },
    runner
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
