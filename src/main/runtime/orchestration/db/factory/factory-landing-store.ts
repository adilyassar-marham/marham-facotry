import type { OrchestrationDb } from '../orchestration-db'
import type { FactoryIntegrationRow, FactoryLandingRow } from './factory-row-types'

export function recordFactoryLanding(
  this: OrchestrationDb,
  params: { runId: string; taskId: string; integrationBranch: string; mergeCommit: string }
): void {
  this.db
    .prepare(
      `INSERT INTO factory_landings (run_id, task_id, integration_branch, merge_commit)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(run_id, task_id) DO UPDATE SET
         integration_branch = excluded.integration_branch,
         merge_commit = excluded.merge_commit,
         landed_at = datetime('now')`
    )
    .run(params.runId, params.taskId, params.integrationBranch, params.mergeCommit)
}

export function listFactoryLandings(this: OrchestrationDb, runId: string): FactoryLandingRow[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare('SELECT * FROM factory_landings WHERE run_id = ? ORDER BY landed_at, task_id')
    .all(runId) as FactoryLandingRow[]
}

export function getFactoryIntegration(
  this: OrchestrationDb,
  runId: string
): FactoryIntegrationRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_integrations WHERE run_id = ?').get(runId) as
    | FactoryIntegrationRow
    | undefined
}

export function recordFactoryIntegration(
  this: OrchestrationDb,
  params: {
    runId: string
    repoId: string
    worktreeId: string
    worktreePath: string
    integrationBranch: string
  }
): void {
  this.db
    .prepare(
      `INSERT INTO factory_integrations
         (run_id, repo_id, worktree_id, worktree_path, integration_branch)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         repo_id = excluded.repo_id,
         worktree_id = excluded.worktree_id,
         worktree_path = excluded.worktree_path,
         integration_branch = excluded.integration_branch`
    )
    .run(
      params.runId,
      params.repoId,
      params.worktreeId,
      params.worktreePath,
      params.integrationBranch
    )
}

export type FactoryLandingStoreMethods = {
  recordFactoryLanding: typeof recordFactoryLanding
  listFactoryLandings: typeof listFactoryLandings
  getFactoryIntegration: typeof getFactoryIntegration
  recordFactoryIntegration: typeof recordFactoryIntegration
}

export function attachFactoryLandingStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    recordFactoryLanding,
    listFactoryLandings,
    getFactoryIntegration,
    recordFactoryIntegration
  })
}
