import { splitWorktreeId } from '../../../../../shared/worktree/id'
import type { OrchestrationDb } from '../orchestration-db'
import type {
  FactoryGateApprovalRow,
  FactoryGateTarget,
  FactoryTaskWorktree,
  FactoryTicketConsumption
} from './factory-row-types'

export function approveFactoryGate(
  this: OrchestrationDb,
  params: { repoId: string; contentHash: string; command: string; timeoutSeconds: number }
): FactoryGateApprovalRow {
  this.db
    .prepare(
      `INSERT INTO factory_gate_approvals (repo_id, content_hash, command, timeout_seconds)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(repo_id) DO UPDATE SET
         content_hash = excluded.content_hash,
         command = excluded.command,
         timeout_seconds = excluded.timeout_seconds,
         approved_at = datetime('now')`
    )
    .run(params.repoId, params.contentHash, params.command, params.timeoutSeconds)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the upsert above guarantees the row exists.
  return this.getFactoryGateApproval(params.repoId) as FactoryGateApprovalRow
}

export function revokeFactoryGate(this: OrchestrationDb, repoId: string): boolean {
  return (
    this.db.prepare('DELETE FROM factory_gate_approvals WHERE repo_id = ?').run(repoId).changes > 0
  )
}

export function getFactoryGateApproval(
  this: OrchestrationDb,
  repoId: string
): FactoryGateApprovalRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_gate_approvals WHERE repo_id = ?').get(repoId) as
    | FactoryGateApprovalRow
    | undefined
}

export function listFactoryGateApprovals(this: OrchestrationDb): FactoryGateApprovalRow[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare('SELECT * FROM factory_gate_approvals ORDER BY repo_id')
    .all() as FactoryGateApprovalRow[]
}

// Why federated and attached dispatches are skipped: their worktree lives on another host, so this
// host can neither run verify there nor judge it; the run home settles them. Review tasks change no
// code, so they are neither gated nor landed.
const GATE_DISPATCH_SQL = `
  SELECT wd.dispatch_id, wd.worktree_id
  FROM worker_dispatches wd
  JOIN dispatch_contexts dc ON dc.id = wd.dispatch_id
  WHERE dc.task_id = ? AND (? IS NULL OR wd.dispatch_id = ?)
    AND wd.worktree_id IS NOT NULL AND wd.worktree_id != ''
    AND NOT EXISTS (SELECT 1 FROM federated_dispatches fd WHERE fd.dispatch_id = wd.dispatch_id)
    AND NOT EXISTS (
      SELECT 1 FROM remote_dispatch_attachments ra WHERE ra.dispatch_id = wd.dispatch_id
    )
    AND NOT EXISTS (SELECT 1 FROM factory_reviews fr WHERE fr.task_id = dc.task_id)
  ORDER BY dc.rowid DESC LIMIT 1`

/** The Task's newest local worker worktree, gated or not. */
export function findFactoryTaskWorktree(
  this: OrchestrationDb,
  taskId: string,
  dispatchId?: string
): FactoryTaskWorktree | undefined {
  const scope = dispatchId ?? null
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the query selects exactly dispatch_id and worktree_id.
  return this.db.prepare(GATE_DISPATCH_SQL).get(taskId, scope, scope) as
    | FactoryTaskWorktree
    | undefined
}

/** Undefined when the Task has no local worker worktree or its repo has the gate off. */
export function resolveFactoryGateTarget(
  this: OrchestrationDb,
  taskId: string,
  dispatchId?: string
): FactoryGateTarget | undefined {
  const row = this.findFactoryTaskWorktree(taskId, dispatchId)
  const repoId = row ? splitWorktreeId(row.worktree_id)?.repoId : undefined
  const approval = repoId ? this.getFactoryGateApproval(repoId) : undefined
  if (!row || !repoId || !approval) {
    return undefined
  }
  return { taskId, dispatchId: row.dispatch_id, worktreeId: row.worktree_id, repoId, approval }
}

/**
 * Runs inside the caller's lifecycle transaction. A gated completion must spend one open pass
 * ticket; an ungated one passes through untouched.
 */
export function consumeFactoryPassTicket(
  this: OrchestrationDb,
  params: { taskId: string; dispatchId?: string }
): FactoryTicketConsumption {
  const target = this.resolveFactoryGateTarget(params.taskId, params.dispatchId)
  if (!target) {
    return { ok: true, gated: false }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the query selects exactly one id column.
  const ticket = this.db
    .prepare(
      `SELECT id FROM factory_verify_results
       WHERE task_id = ? AND ticket = 'open' AND (? IS NULL OR dispatch_id = ?)
       ORDER BY rowid DESC LIMIT 1`
    )
    .get(params.taskId, params.dispatchId ?? null, params.dispatchId ?? null) as
    | { id: string }
    | undefined
  if (!ticket) {
    return {
      ok: false,
      code: 'factory_verify_required',
      reason:
        `Task ${params.taskId} is in a repo with the factory quality gate on, and no passing ` +
        `verify is on record for it. Run \`orca factory verify --task ${params.taskId}\` and ` +
        'complete the task only after it passes.'
    }
  }
  this.db
    .prepare(`UPDATE factory_verify_results SET ticket = 'consumed' WHERE id = ?`)
    .run(ticket.id)
  return { ok: true, gated: true }
}

export type FactoryGateStoreMethods = {
  approveFactoryGate: typeof approveFactoryGate
  revokeFactoryGate: typeof revokeFactoryGate
  getFactoryGateApproval: typeof getFactoryGateApproval
  listFactoryGateApprovals: typeof listFactoryGateApprovals
  findFactoryTaskWorktree: typeof findFactoryTaskWorktree
  resolveFactoryGateTarget: typeof resolveFactoryGateTarget
  consumeFactoryPassTicket: typeof consumeFactoryPassTicket
}

export function attachFactoryGateStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    approveFactoryGate,
    revokeFactoryGate,
    getFactoryGateApproval,
    listFactoryGateApprovals,
    findFactoryTaskWorktree,
    resolveFactoryGateTarget,
    consumeFactoryPassTicket
  })
}
