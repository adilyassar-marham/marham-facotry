import type { OrchestrationDb } from '../orchestration-db'
import { createCoreTablesSql } from './create-core-tables-sql'
import { createGraphTablesSql } from './create-graph-tables-sql'
import { DERIVED_DELIVERY_SCHEMA_SQL } from './migrate-v41'
import { FACTORY_TABLES_SQL } from '../factory/factory-tables-sql'

export function createTables(this: OrchestrationDb): void {
  this.db.exec(`${createCoreTablesSql()}\n${createGraphTablesSql()}`)
  this.createMailboxDeliveryIndexesIfPossible()
  this.db.exec(DERIVED_DELIVERY_SCHEMA_SQL)
  // Why no version bump: additive IF-NOT-EXISTS tables are created on every open, old and new.
  this.db.exec(FACTORY_TABLES_SQL)
}

export type CreateTablesMethods = {
  createTables: typeof createTables
}

export function attachCreateTables(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    createTables
  })
}
