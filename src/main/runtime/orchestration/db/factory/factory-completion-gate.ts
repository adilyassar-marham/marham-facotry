import { OrchestrationError } from '../../orchestration-error'
import type { WorkerReportOutcome, WorkerReportSettlement } from '../../types'
import type { OrchestrationDb } from '../orchestration-db'

type Rejection = Extract<WorkerReportSettlement, { action: 'rejected' }>

/** Worker-report door: a gated success must spend a pass ticket inside the settling transaction. */
export function refuseUnverifiedWorkerSuccess(
  db: OrchestrationDb,
  params: { taskId: string; dispatchId: string; outcome: WorkerReportOutcome }
): Rejection | undefined {
  if (params.outcome !== 'succeeded') {
    return undefined
  }
  const consumed = db.consumeFactoryPassTicket({
    taskId: params.taskId,
    dispatchId: params.dispatchId
  })
  return consumed.ok
    ? undefined
    : { action: 'rejected', code: consumed.code, reason: consumed.reason }
}

/** Coordinator door (`taskUpdate --status completed`): same rule, any dispatch of the Task. */
export function assertVerifiedTaskCompletion(db: OrchestrationDb, taskId: string): void {
  const consumed = db.consumeFactoryPassTicket({ taskId })
  if (!consumed.ok) {
    throw new OrchestrationError(consumed.code, consumed.reason, { taskId })
  }
}
