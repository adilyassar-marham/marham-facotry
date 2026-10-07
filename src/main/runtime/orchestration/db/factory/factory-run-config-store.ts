import type { OrchestrationDb } from '../orchestration-db'
import type { FactoryRunConfigRow } from './factory-row-types'

/** First write wins: a run keeps the rules it started under even if the base branch moves. */
export function recordFactoryRunConfig(
  this: OrchestrationDb,
  row: Omit<FactoryRunConfigRow, 'created_at'>
): FactoryRunConfigRow {
  this.db
    .prepare(
      `INSERT INTO factory_run_configs
         (run_id, base_ref, base_commit, verify, setup, guidelines, max_workers, max_fix_rounds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO NOTHING`
    )
    .run(
      row.run_id,
      row.base_ref,
      row.base_commit,
      row.verify,
      row.setup,
      row.guidelines,
      row.max_workers,
      row.max_fix_rounds
    )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: inserted or already present above.
  return this.getFactoryRunConfig(row.run_id) as FactoryRunConfigRow
}

export function getFactoryRunConfig(
  this: OrchestrationDb,
  runId: string
): FactoryRunConfigRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_run_configs WHERE run_id = ?').get(runId) as
    | FactoryRunConfigRow
    | undefined
}

export type FactoryRunConfigStoreMethods = {
  recordFactoryRunConfig: typeof recordFactoryRunConfig
  getFactoryRunConfig: typeof getFactoryRunConfig
}

export function attachFactoryRunConfigStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, { recordFactoryRunConfig, getFactoryRunConfig })
}
