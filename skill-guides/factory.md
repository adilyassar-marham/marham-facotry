---
name: factory
description: >-
  Run Orca's software factory: turn a goal, PRD, or ticket into a dependency
  graph of small tasks with acceptance criteria, dispatch supervised workers,
  let the repo's approved verify gate judge every "done", land verified work
  onto one factory integration branch, and loop a guideline review with
  fixes until it passes, so a person can open the PR. Use when asked to "plan
  and build", "use the factory", "decompose and ship", or run many tasks end to
  end. Builds on the orchestration skill for dispatch.
---

# Orca software factory

`ORCA` is a placeholder for the executable you resolved in the stub; substitute it before running.

The loop: **baseline → plan → build → land → review → fix → … → PR**. You are the
coordinator. Orca enforces every judgement: the verify gate, the review verdict, the
round limit, and the PR. You never decide "done", "passed", or "ready" yourself.

## Outcome

**Result:** `factory/<run>` holds every task, passes verify, and has a passing
guideline review at its current commit. **Done:** you report the integration
branch, the review result, and every task that is not landed with its reason, then
say the PR is ready for a person to open. You never push, never open the PR, never
merge into the base branch, and never edit `orca.yaml` or a guideline file.

## 0. Baseline (always first)

```text
ORCA orchestration run-create --objective "<goal>" --json
ORCA factory baseline --run <run-id>
```

This creates `factory/<run>` from the base, runs the repo setup (e.g. `npm install`)
there, and runs verify. If the baseline **fails**, independent tasks would each fail
the gate on the existing errors: `factory plan` then accepts only ONE root task (which
makes the baseline pass), and every other task must depend on it.

## 1. Plan

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
      "acceptance": ["double submit creates one refund"],
      "deps": ["schema"]
    }
  ]
}
```

```text
ORCA factory plan --file plan.json --run <run-id>
```

Keep the plan file outside the repo or under `.orca/` (never committed). One task is
one reviewable change. The whole plan is rejected if any part is invalid.

## 2. Build

Start every worker from the integration branch, so it sees everything already landed:

```text
ORCA orchestration worker-start --task <task-id> --worktree new-child --base-branch factory/<run-id> --setup run --run <run-id>
```

- Start a task only after all its deps have **landed** (step 3), not just completed.
- Orca caps parallel workers per run (Settings); a refused start means wait for a
  `worker_done`.
- Tell workers: **commit all work before `worker_done`**. The gate refuses
  uncommitted changes, then runs the approved verify in the worker's worktree. On a
  refusal the worker sees why and must fix, commit, and resend — or report
  `--outcome failed`.

## 3. Land

```text
ORCA factory land --run <run-id>
```

Merges completed, verified tasks onto `factory/<run>` in dependency order, re-runs
setup, then verifies the combined branch. A branch with no commits is skipped, never
reported as merged. On a conflict the merge is aborted and land stops: dispatch a
task (from `factory/<run>`) to resolve it, then land again. Land after each wave.

## 4. Review

When every task is landed and the combined verify passed:

```text
ORCA factory review --run <run-id>
```

- `reviewer_needed`: start a **fresh** worker on the printed review task with the
  printed command (`--base-branch factory/<run-id> --setup skip`). Never reuse a
  worker that built this run. The reviewer files its verdict through `worker_done
--report-path`; Orca records it.
- `failed_mechanically`: the branch carries secrets or gate/guideline edits; go to
  step 5.
- `already_passed`: go to step 6.

## 5. Fix (on a failed review)

```text
ORCA factory fix --run <run-id>
```

Creates one fix task from the exact findings. Start it from `factory/<run-id>`
(step 2), land it (step 3), then review again (step 4). When Orca answers
`factory_needs_human`, the fix-round limit is spent: stop and report the findings.

## 6. Hand off

`ORCA factory board --run <run-id>` shows every task, the checks, the review, and
whether the PR is ready. Report the integration branch and tell the person to open
the draft PR from Settings → Orchestration → Software factory. Then:

```text
ORCA factory cleanup --run <run-id>
```

removes clean worktrees of landed and reviewed tasks (the integration worktree stays).

## Request mode (a teammate's request from the Requests screen)

Your first message names a request id. The requester is not technical and never reads
your terminal: everything you need from them goes through these commands, which show
up on their screen.

1. Baseline with the request: `ORCA factory baseline --run <run-id> --request <request-id>`.
2. Only if something is truly unclear, ask in plain words (no code, no file names), at
   most 3 questions in total:
   `ORCA factory ask --run <run-id> --question "Should the fee show before or after the discount?"`
   An answer of "waiting" means they have not replied yet; repeat with
   `--question-id <id>` until it returns the answer.
3. Write task titles and specs a non-engineer can follow, then `ORCA factory plan`.
4. Wait for their decision: `ORCA factory await-approval --run <run-id>` (repeat while
   it says waiting). Workers cannot start before approval; Orca refuses them.
   On "changes requested", revise the plan with their feedback and run
   `ORCA factory plan` again; the old unstarted tasks are retired for you.
5. Continue with steps 2-6 above. The requester sends the PR from their screen.
