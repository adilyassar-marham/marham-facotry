import type { OrchestrationDb } from '../orchestration-db'
import type {
  FactoryBriefFactsRow,
  FactoryRequestBaseRow,
  FactoryRunRiskPathRow,
  FactoryRunSkillPackRow,
  FactoryRunSkillRow
} from './factory-row-types'

export function recordFactoryRequestBase(
  this: OrchestrationDb,
  row: { request_id: string; base_ref: string; base_commit: string }
): void {
  this.db
    .prepare(
      `INSERT INTO factory_request_bases (request_id, base_ref, base_commit)
       VALUES (?, ?, ?)
       ON CONFLICT(request_id) DO UPDATE SET
         base_ref = excluded.base_ref,
         base_commit = excluded.base_commit`
    )
    .run(row.request_id, row.base_ref, row.base_commit)
}

export function getFactoryRequestBase(
  this: OrchestrationDb,
  requestId: string
): FactoryRequestBaseRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare('SELECT * FROM factory_request_bases WHERE request_id = ?')
    .get(requestId) as FactoryRequestBaseRow | undefined
}

export function getFactoryRunSkillPack(
  this: OrchestrationDb,
  runId: string
): FactoryRunSkillPackRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db.prepare('SELECT * FROM factory_run_skill_packs WHERE run_id = ?').get(runId) as
    | FactoryRunSkillPackRow
    | undefined
}

export function listFactoryRunSkills(this: OrchestrationDb, runId: string): FactoryRunSkillRow[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare('SELECT * FROM factory_run_skills WHERE run_id = ? ORDER BY stage, skill')
    .all(runId) as FactoryRunSkillRow[]
}

export function listFactoryRunRiskPaths(
  this: OrchestrationDb,
  runId: string
): FactoryRunRiskPathRow[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare('SELECT * FROM factory_run_risk_paths WHERE run_id = ? ORDER BY path')
    .all(runId) as FactoryRunRiskPathRow[]
}

export function replaceFactorySkillSnapshot(
  this: OrchestrationDb,
  params: {
    runId: string
    pack: FactoryRunSkillPackRow | null
    skills: FactoryRunSkillRow[]
    paths: string[]
  }
): void {
  const deleteSkills = this.db.prepare('DELETE FROM factory_run_skills WHERE run_id = ?')
  const deletePaths = this.db.prepare('DELETE FROM factory_run_risk_paths WHERE run_id = ?')
  const deletePack = this.db.prepare('DELETE FROM factory_run_skill_packs WHERE run_id = ?')
  const insertSkill = this.db.prepare(
    `INSERT INTO factory_run_skills (run_id, stage, skill, sha256, source, pinned_commit)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const insertPath = this.db.prepare(
    'INSERT INTO factory_run_risk_paths (run_id, path) VALUES (?, ?)'
  )
  const insertPack = this.db.prepare(
    `INSERT INTO factory_run_skill_packs (run_id, base_commit, pack, overlays, budget_chars)
     VALUES (?, ?, ?, ?, ?)`
  )
  deleteSkills.run(params.runId)
  deletePaths.run(params.runId)
  deletePack.run(params.runId)
  for (const row of params.skills) {
    insertSkill.run(row.run_id, row.stage, row.skill, row.sha256, row.source, row.pinned_commit)
  }
  for (const path of params.paths) {
    insertPath.run(params.runId, path)
  }
  if (params.pack) {
    insertPack.run(
      params.pack.run_id,
      params.pack.base_commit,
      params.pack.pack,
      params.pack.overlays,
      params.pack.budget_chars
    )
  }
}

export function recordFactoryBriefFacts(
  this: OrchestrationDb,
  row: {
    request_id: string
    version: number
    triage: 'bug' | null
    files_json: string
    new_module: number
  }
): void {
  this.db
    .prepare(
      `INSERT INTO factory_brief_facts (request_id, version, triage, files_json, new_module)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(request_id, version) DO UPDATE SET
         triage = excluded.triage,
         files_json = excluded.files_json,
         new_module = excluded.new_module`
    )
    .run(row.request_id, row.version, row.triage, row.files_json, row.new_module)
}

export function getFactoryBriefFacts(
  this: OrchestrationDb,
  requestId: string,
  version: number
): FactoryBriefFactsRow | undefined {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SELECT * on this store's own table returns exactly the declared row shape.
  return this.db
    .prepare('SELECT * FROM factory_brief_facts WHERE request_id = ? AND version = ?')
    .get(requestId, version) as FactoryBriefFactsRow | undefined
}

export type FactorySkillStoreMethods = {
  recordFactoryRequestBase: typeof recordFactoryRequestBase
  getFactoryRequestBase: typeof getFactoryRequestBase
  getFactoryRunSkillPack: typeof getFactoryRunSkillPack
  listFactoryRunSkills: typeof listFactoryRunSkills
  listFactoryRunRiskPaths: typeof listFactoryRunRiskPaths
  replaceFactorySkillSnapshot: typeof replaceFactorySkillSnapshot
  recordFactoryBriefFacts: typeof recordFactoryBriefFacts
  getFactoryBriefFacts: typeof getFactoryBriefFacts
}

export function attachFactorySkillStore(ctor: { prototype: object }): void {
  const proto = ctor.prototype
  Object.assign(proto, {
    recordFactoryRequestBase,
    getFactoryRequestBase,
    getFactoryRunSkillPack,
    listFactoryRunSkills,
    listFactoryRunRiskPaths,
    replaceFactorySkillSnapshot,
    recordFactoryBriefFacts,
    getFactoryBriefFacts
  })
}
