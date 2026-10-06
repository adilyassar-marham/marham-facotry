import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import type { FactoryVerifyResultRow, FactoryVerifyStatus } from './factory-row-types'

/** Opens a verify attempt; earlier unspent passes for the Task are superseded so none can be reused. */
export function beginFactoryVerify(
  this: OrchestrationDb,
  params: { taskId: string; dispatchId: string | null; worktreeId: string }
): string {
  const id = generateId('fver')
  this.db.exec('SAVEPOINT factory_verify_begin')
  try {
    this.db
      .prepare(
        `UPDATE factory_verify_results SET ticket = 'superseded'
         WHERE task_id = ? AND ticket = 'open'`
      )
      .run(params.taskId)
    this.db
      .prepare(
        `INSERT INTO factory_verify_results (id, task_id, dispatch_id, worktree_id, status)
         VALUES (?, ?, ?, ?, 'running')`
      )
      .run(id, params.taskId, params.dispatchId, params.worktreeId)
    this.db.exec('RELEASE factory_verify_begin')
  } catch (error) {
    this.db.exec('ROLLBACK TO factory_verify_begin')
    this.db.exec('RELEASE factory_verify_begin')
    throw error
  }
  return id
}

export function finishFactoryVerify(
  this: OrchestrationDb,
  params: {
    id: string
    status: Exclude<FactoryVerifyStatus, 'running'>
    exitCode: number | null
    timedOut: boolean
    durationMs: number
    outputTail: string
  }
): FactoryVerifyResultRow {
  this.db
    .prepare(
      `UPDATE factory_verify_results
       SET status = ?, ticket = ?, exit_code = ?, timed_out = ?, duration_ms = ?,
           output_tail = ?, completed_at = datetime('now')
       WHERE id = ? AND status = 'running'`
    )
    .run(
      params.status,
      params.status === 'passed' ? 'open' : 'none',
      params.exitCode,
      params.timedOut ? 1 : 0,
      params.durationMs,
      params.outputTail,
      params.id
    )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: beginFactoryVerify inserted this id.
  return this.getFactoryVerifyResult(params.id) as FactoryVerifyResultRow
}

export function getFactoryVerifyResult(
  this: OrchestrationDb,
  id: string
): FactoryVerifyResultRow | undefined {
  return this.db.prepare('SELECT * FROM factory_verify_results WHERE id = ?').get(id) as
    | FactoryVerifyResultRow
    | undefined
}

/** Latest attempt per Task, for the board. */
export function listLatestFactoryVerifyResults(
  this: OrchestrationDb,
  taskIds: readonly string[]
): Map<string, FactoryVerifyResultRow> {
  const latest = new Map<string, FactoryVerifyResultRow>()
  const statement = this.db.prepare(
    'SELECT * FROM factory_verify_results WHERE task_id = ? ORDER BY rowid DESC LIMIT 1'
  )
  for (const taskId of taskIds) {
    const row = statement.get(taskId) as FactoryVerifyResultRow | undefined
    if (row) {
      latest.set(taskId, row)
    }
  }
  return latest
}

export type FactoryVerifyStoreMethods = {
  beginFactoryVerify: typeof beginFactoryVerify
  finishFactoryVerify: typeof finishFactoryVerify
  getFactoryVerifyResult: typeof getFactoryVerifyResult
  listLatestFactoryVerifyResults: typeof listLatestFactoryVerifyResults
}

export function attachFactoryVerifyStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    beginFactoryVerify,
    finishFactoryVerify,
    getFactoryVerifyResult,
    listLatestFactoryVerifyResults
  })
}
