import type { TaskRow } from '../../types'
import { OrchestrationError } from '../../orchestration-error'
import { generateId } from '../generated-id'
import type { OrchestrationDb } from '../orchestration-db'
import type {
  FactoryCheckRow,
  FactoryPullRequestRow,
  FactoryRepoSettingsRow,
  FactoryRunRow
} from './factory-row-types'

export function upsertFactoryRun(
  this: OrchestrationDb,
  params: {
    runId: string
    repoId: string
    baseBranch: string | null
    maxWorkers: number
    maxFixRounds: number
  }
): FactoryRunRow {
  this.db
    .prepare(
      `INSERT INTO factory_runs (run_id, repo_id, base_branch, max_workers, max_fix_rounds)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO NOTHING`
    )
    .run(params.runId, params.repoId, params.baseBranch, params.maxWorkers, params.maxFixRounds)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: inserted or already present above.
  return this.getFactoryRun(params.runId) as FactoryRunRow
}

export function getFactoryRun(this: OrchestrationDb, runId: string): FactoryRunRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_runs WHERE run_id = ?').get(runId) as
    | FactoryRunRow
    | undefined
}

/** First write wins: the fork point is fixed once the integration branch exists. */
export function setFactoryRunBaseSha(this: OrchestrationDb, runId: string, baseSha: string): void {
  this.db
    .prepare('UPDATE factory_runs SET base_sha = ? WHERE run_id = ? AND base_sha IS NULL')
    .run(baseSha, runId)
}

export function recordFactoryCheck(
  this: OrchestrationDb,
  params: Omit<FactoryCheckRow, 'id' | 'created_at' | 'timed_out'> & { timed_out: boolean }
): FactoryCheckRow {
  const id = generateId('fchk')
  this.db
    .prepare(
      `INSERT INTO factory_checks
         (id, run_id, kind, head_sha, status, exit_code, timed_out, duration_ms, output_tail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.run_id,
      params.kind,
      params.head_sha,
      params.status,
      params.exit_code,
      params.timed_out ? 1 : 0,
      params.duration_ms,
      params.output_tail
    )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_checks WHERE id = ?').get(id) as FactoryCheckRow
}

export function getLatestFactoryCheck(
  this: OrchestrationDb,
  runId: string,
  kind: FactoryCheckRow['kind']
): FactoryCheckRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare(
      'SELECT * FROM factory_checks WHERE run_id = ? AND kind = ? ORDER BY rowid DESC LIMIT 1'
    )
    .get(runId, kind) as FactoryCheckRow | undefined
}

export function recordFactoryPullRequest(
  this: OrchestrationDb,
  row: Omit<FactoryPullRequestRow, 'opened_at'>
): void {
  this.db
    .prepare(
      `INSERT INTO factory_pull_requests
         (run_id, url, number, head_branch, base_branch, head_sha)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET url = excluded.url, number = excluded.number,
         head_sha = excluded.head_sha, opened_at = datetime('now')`
    )
    .run(row.run_id, row.url, row.number, row.head_branch, row.base_branch, row.head_sha)
}

export function getFactoryPullRequest(
  this: OrchestrationDb,
  runId: string
): FactoryPullRequestRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_pull_requests WHERE run_id = ?').get(runId) as
    | FactoryPullRequestRow
    | undefined
}

export function getFactoryRepoSettings(
  this: OrchestrationDb,
  repoId: string
): FactoryRepoSettingsRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_repo_settings WHERE repo_id = ?').get(repoId) as
    | FactoryRepoSettingsRow
    | undefined
}

export function saveFactoryRepoSettings(
  this: OrchestrationDb,
  params: { repoId: string; guidelines: string[]; maxWorkers: number; maxFixRounds: number }
): void {
  this.db
    .prepare(
      `INSERT INTO factory_repo_settings (repo_id, guidelines, max_workers, max_fix_rounds)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(repo_id) DO UPDATE SET guidelines = excluded.guidelines,
         max_workers = excluded.max_workers, max_fix_rounds = excluded.max_fix_rounds,
         updated_at = datetime('now')`
    )
    .run(params.repoId, JSON.stringify(params.guidelines), params.maxWorkers, params.maxFixRounds)
}

/**
 * Runs inside the dispatch-start transaction. Only factory runs carry a limit; review rounds count
 * too, since a reviewer is a worker like any other.
 */
export function assertFactoryWorkerCapacity(this: OrchestrationDb, task: TaskRow): void {
  const run = this.getFactoryRun(task.run_id)
  if (!run) {
    return
  }
  const approval = this.getFactoryPlanApproval(task.run_id)
  if (approval?.status === 'approved' && approval.feedback) {
    throw new OrchestrationError(
      'factory_plan_changes_pending',
      `The requester approved run ${task.run_id} with changes. Update the plan with ` +
        `\`orca factory plan\` so it includes this, then start workers. Do not ask again:\n${approval.feedback}`,
      { runId: task.run_id }
    )
  }
  if (approval && approval.status !== 'approved') {
    throw new OrchestrationError(
      'factory_plan_awaiting_approval',
      `The requester has not approved run ${task.run_id}'s plan yet. Run \`orca factory ` +
        `await-approval --run ${task.run_id}\` and start workers only once it says approved.`,
      { runId: task.run_id, approval: approval.status }
    )
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: COUNT(*) AS count always yields one numeric row.
  const active = this.db
    .prepare(`SELECT COUNT(*) AS count FROM tasks WHERE run_id = ? AND status = 'dispatched'`)
    .get(task.run_id) as { count: number }
  if (active.count >= run.max_workers) {
    throw new OrchestrationError(
      'factory_worker_limit',
      `Run ${task.run_id} already has ${active.count} active worker(s), its factory limit. ` +
        'Wait for a worker_done, then start the next task.',
      { runId: task.run_id, maxWorkers: run.max_workers }
    )
  }
}

export type FactoryRunStoreMethods = {
  upsertFactoryRun: typeof upsertFactoryRun
  getFactoryRun: typeof getFactoryRun
  setFactoryRunBaseSha: typeof setFactoryRunBaseSha
  recordFactoryCheck: typeof recordFactoryCheck
  getLatestFactoryCheck: typeof getLatestFactoryCheck
  recordFactoryPullRequest: typeof recordFactoryPullRequest
  getFactoryPullRequest: typeof getFactoryPullRequest
  getFactoryRepoSettings: typeof getFactoryRepoSettings
  saveFactoryRepoSettings: typeof saveFactoryRepoSettings
  assertFactoryWorkerCapacity: typeof assertFactoryWorkerCapacity
}

export function attachFactoryRunStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    upsertFactoryRun,
    getFactoryRun,
    setFactoryRunBaseSha,
    recordFactoryCheck,
    getLatestFactoryCheck,
    recordFactoryPullRequest,
    getFactoryPullRequest,
    getFactoryRepoSettings,
    saveFactoryRepoSettings,
    assertFactoryWorkerCapacity
  })
}
