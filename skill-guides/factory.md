---
name: factory
description: >-
  Run Orca's software factory: turn a goal, PRD, or ticket into a dependency
  graph of small tasks with acceptance criteria, dispatch supervised workers,
  let the repo's approved verify gate judge every "done", and land verified
  work onto one factory/<run> integration branch for human review. Use when
  asked to "plan and build", "use the factory", "decompose and ship", or run
  many tasks end to end. Builds on the orchestration skill for dispatch.
---

# Orca software factory

`ORCA` is a placeholder for the executable you resolved in the stub; substitute it before running.

The factory is a loop on top of orchestration: **plan → dispatch → verify → land →
review**. You are the coordinator. Orca enforces the gate; you never judge "done"
yourself.

## Outcome

**Result:** every task in the plan is landed on `factory/<run>`, or has a named
reason it is not. **Done:** you report the integration branch, the land result,
the integration verify result, and every skipped or failed task with its reason.
Merging to the base branch is a human decision — never do it.

## 1. Plan

Write a plan file, then apply it atomically. Small, independent tasks land
cleanly; one task should be one reviewable change.

```json
{
  "tasks": [
    {
      "key": "schema",
      "title": "Refund tables",
      "spec": "Add refund and refund_event tables with a migration.",
      "acceptance": ["migration is reversible", "unique (appointment_id, idempotency_key)"]
    },
    {
      "key": "api",
      "title": "Refund request API",
      "spec": "POST /refunds creates a refund in Requested.",
      "acceptance": ["double submit creates one refund", "rejects unknown appointment"],
      "deps": ["schema"]
    }
  ]
}
```

```text
ORCA factory plan --file plan.json
```

Rules: `key` is 1-64 of letters, digits, `.`, `-`, `_`; `deps` name other keys;
no cycles. The whole plan is rejected if any part is invalid, so nothing is
half-created. Acceptance criteria are folded into each task's spec, so workers
see them in their preamble.

## 2. Dispatch

Use the orchestration skill's normal loop (`ORCA skills get orchestration`):
start a worker per ready task in its own child worktree, wait for
`worker_done`, then dispatch the tasks that became ready.

## 3. Verify (enforced by Orca, not by you)

If the repo's quality gate is on (`ORCA factory gate status`), a worker's
`worker_done --outcome succeeded` runs the approved `scripts.verify` in that
worker's worktree first. If verify fails, the report is refused, the task stays
open, and the worker sees the failing output — it should fix and resend, or
report `--outcome failed`. To complete a task yourself after its worker is gone,
run `ORCA factory verify --task <id>` first; completion without a pass is refused.

Only a person can enable, approve, or turn off the gate, in Settings →
Orchestration. Never edit `orca.yaml`'s `scripts.verify` to get past it: a
changed command stops all completions until a person re-approves it.

## 4. Land

```text
ORCA factory land --run <run-id>
```

Merges every completed, verified task onto `factory/<run>` in dependency order,
then runs verify on the combined branch. On a conflict it aborts that merge and
stops, leaving the branch clean: dispatch a task to resolve the conflict against
`factory/<run>`, then land again. Re-running land is safe; landed tasks are kept.

## 5. Review

`ORCA factory board --run <run-id>` shows every task's stage. Report back with
the integration branch so a person can open a review for it.
