// Why orchestration.db: the lifecycle transaction must consume a verify pass atomically with the
// task transition, which a separate database could not do.
export const FACTORY_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS factory_gate_approvals (
  repo_id          TEXT PRIMARY KEY,
  content_hash     TEXT NOT NULL,
  command          TEXT NOT NULL,
  timeout_seconds  INTEGER NOT NULL,
  approved_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A passed row carries a single-use ticket: completing a gated Task consumes exactly one.
CREATE TABLE IF NOT EXISTS factory_verify_results (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL,
  dispatch_id   TEXT,
  worktree_id   TEXT NOT NULL,
  status        TEXT NOT NULL
    CHECK(status IN ('running', 'passed', 'failed', 'not_approved', 'error')),
  ticket        TEXT NOT NULL DEFAULT 'none'
    CHECK(ticket IN ('none', 'open', 'consumed', 'superseded')),
  exit_code     INTEGER,
  timed_out     INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER,
  output_tail   TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_factory_verify_results_task
  ON factory_verify_results(task_id);
CREATE INDEX IF NOT EXISTS idx_factory_verify_results_dispatch
  ON factory_verify_results(dispatch_id);

-- One integration worktree per run, reused by every later land so merges accumulate.
CREATE TABLE IF NOT EXISTS factory_integrations (
  run_id              TEXT PRIMARY KEY,
  repo_id             TEXT NOT NULL,
  worktree_id         TEXT NOT NULL,
  worktree_path       TEXT NOT NULL,
  integration_branch  TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS factory_landings (
  run_id              TEXT NOT NULL,
  task_id             TEXT NOT NULL,
  integration_branch  TEXT NOT NULL,
  merge_commit        TEXT NOT NULL,
  landed_at           TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (run_id, task_id)
);
`

// Why approvals are absent: they are repo policy, not run state, so a run reset must keep them.
export const FACTORY_RUN_STATE_RESET_SQL = `
    DELETE FROM factory_verify_results;
    DELETE FROM factory_landings;
    DELETE FROM factory_integrations;
`
