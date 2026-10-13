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

-- Per-run factory policy, captured from repo settings when the run's integration branch is made.
CREATE TABLE IF NOT EXISTS factory_runs (
  run_id          TEXT PRIMARY KEY,
  repo_id         TEXT NOT NULL,
  base_branch     TEXT,
  base_sha        TEXT,
  max_workers     INTEGER NOT NULL,
  max_fix_rounds  INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Whole-branch verify runs, pinned to the integration commit they judged.
CREATE TABLE IF NOT EXISTS factory_checks (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK(kind IN ('baseline', 'integration')),
  head_sha     TEXT NOT NULL,
  status       TEXT NOT NULL
    CHECK(status IN ('passed', 'failed', 'not_approved', 'error')),
  exit_code    INTEGER,
  timed_out    INTEGER NOT NULL DEFAULT 0,
  duration_ms  INTEGER,
  output_tail  TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_factory_checks_run ON factory_checks(run_id, kind);

-- One row per review round; task_id is NULL when Orca failed the round itself (blocked paths).
CREATE TABLE IF NOT EXISTS factory_reviews (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL,
  round         INTEGER NOT NULL,
  task_id       TEXT UNIQUE,
  head_sha      TEXT NOT NULL,
  verdict       TEXT NOT NULL DEFAULT 'pending' CHECK(verdict IN ('pending', 'pass', 'fail')),
  summary       TEXT NOT NULL DEFAULT '',
  findings      TEXT NOT NULL DEFAULT '[]',
  fix_task_id   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_factory_reviews_run ON factory_reviews(run_id, round);

CREATE TABLE IF NOT EXISTS factory_pull_requests (
  run_id       TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  number       INTEGER,
  head_branch  TEXT NOT NULL,
  base_branch  TEXT NOT NULL,
  head_sha     TEXT NOT NULL,
  opened_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The committed rules a managed run uses, captured once at baseline from the base branch.
CREATE TABLE IF NOT EXISTS factory_run_configs (
  run_id          TEXT PRIMARY KEY,
  base_ref        TEXT NOT NULL,
  base_commit     TEXT NOT NULL,
  verify          TEXT NOT NULL,
  setup           TEXT,
  guidelines      TEXT NOT NULL DEFAULT '[]',
  max_workers     INTEGER,
  max_fix_rounds  INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A teammate's change request; its coordinator links the run on baseline (--request).
CREATE TABLE IF NOT EXISTS factory_requests (
  id            TEXT PRIMARY KEY,
  repo_id       TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  agent         TEXT NOT NULL,
  worktree_id   TEXT,
  run_id        TEXT UNIQUE,
  cancelled     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A requested run's plan waits here for the requester; workers cannot start until approved.
CREATE TABLE IF NOT EXISTS factory_plan_approvals (
  run_id      TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK(status IN ('awaiting', 'approved', 'changes_requested')),
  feedback    TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS factory_questions (
  id           TEXT PRIMARY KEY,
  run_id       TEXT NOT NULL,
  question     TEXT NOT NULL,
  answer       TEXT,
  asked_at     TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_factory_questions_run ON factory_questions(run_id);

-- Person-owned repo policy, written only through renderer IPC like gate approvals.
CREATE TABLE IF NOT EXISTS factory_repo_settings (
  repo_id         TEXT PRIMARY KEY,
  guidelines      TEXT NOT NULL DEFAULT '[]',
  max_workers     INTEGER NOT NULL,
  max_fix_rounds  INTEGER NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The person turned off the built-in check. No row means the shipped check stays on.
CREATE TABLE IF NOT EXISTS factory_gate_declines (
  repo_id     TEXT PRIMARY KEY,
  declined_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Conversation for one request. Kept across run resets: it belongs to the person, not the run.
CREATE TABLE IF NOT EXISTS factory_messages (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL,
  author      TEXT NOT NULL CHECK (author IN ('agent', 'requester')),
  kind        TEXT NOT NULL CHECK (kind IN ('say', 'question', 'answer', 'brief')),
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_factory_messages_request ON factory_messages(request_id, created_at);

CREATE TABLE IF NOT EXISTS factory_request_questions (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL,
  question      TEXT NOT NULL,
  choices_json  TEXT NOT NULL DEFAULT '[]',
  recommended   INTEGER,
  why           TEXT,
  answer        TEXT,
  asked_at      TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_factory_request_questions_request
  ON factory_request_questions(request_id);

CREATE TABLE IF NOT EXISTS factory_briefs (
  request_id       TEXT NOT NULL,
  version          INTEGER NOT NULL,
  person_md        TEXT NOT NULL,
  agent_md         TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN (
                     'app_only', 'needs_backend', 'app_and_backend', 'needs_native', 'not_feasible'
                   )),
  acceptance_json  TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'changes_requested')),
  feedback         TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (request_id, version)
);
`

// Why approvals and repo settings are absent: they are repo policy, not run state.
export const FACTORY_RUN_STATE_RESET_SQL = `
    DELETE FROM factory_verify_results;
    DELETE FROM factory_landings;
    DELETE FROM factory_integrations;
    DELETE FROM factory_runs;
    DELETE FROM factory_checks;
    DELETE FROM factory_reviews;
    DELETE FROM factory_pull_requests;
    DELETE FROM factory_plan_approvals;
    DELETE FROM factory_run_configs;
    DELETE FROM factory_questions;
    UPDATE factory_requests SET run_id = NULL;
`
