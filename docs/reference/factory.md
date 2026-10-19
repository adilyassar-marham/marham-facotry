# Software factory

The factory turns orchestration into a production line: **baseline → plan → build → land →
review → fix → PR**. Dispatch is plain orchestration; the factory adds the stages around it.
Coordinator agents learn the loop from the `factory` skill (`orca skills get factory`).

| Stage    | Entry point                                      | Code                                                 |
| -------- | ------------------------------------------------ | ---------------------------------------------------- |
| Intake   | `orca factory say`, `ask`, `brief`, `await-brief` | `factory-intake.ts`, `prompts/intake.md`            |
| Baseline | `orca factory baseline` / `factory.baseline`     | `factory-baseline.ts`, `factory-integration.ts`      |
| Plan     | `orca factory plan --file` / `factory.planApply` | `factory-plan.ts`                                    |
| Verify   | `worker_done`, `factory verify`                  | `factory-verify.ts`, `factory-worker-done-gate.ts`   |
| Land     | `orca factory land` / `factory.land`             | `factory-land.ts`, `factory-land-selection.ts`       |
| Review   | `orca factory review` / `factory.review`         | `factory-review.ts`, `factory-review-report.ts`      |
| Fix      | `orca factory fix` / `factory.fix`               | `factory-review.ts`                                  |
| PR       | Settings button only (`factoryGate:openPullRequest`) | `factory-pr.ts`, `factory-pr-body.ts`            |
| Cleanup  | `orca factory cleanup` / `factory.cleanup`       | `factory-cleanup.ts`                                 |
| Board    | Settings → Orchestration, `factory board`        | `factory-board.ts`, `factory-run-report.ts`, `FactoryPanel.tsx` |

## The quality gate is enforced, not advised

A repo opts in by adding `scripts.verify` to `orca.yaml` and a person approving it in Settings.
From then on a gated Task cannot become `completed` without a passing verify. Orca does not
pick that command. For this app it should run `npx tsc --noEmit` and ESLint on the changed
files (`npx expo lint`, or `eslint` on those paths).

**Every completion door is gated.** A Task reaches `completed` through the worker report
(`settleWorkerReportInTransaction`) or a coordinator override (`updateTaskStatus`). Both call
`factory-completion-gate.ts` inside their lifecycle transaction. Adding a third writer of
`completed` without that call is a gate bypass.

**Verify runs before the lock, the transaction spends a ticket.** The settling transaction holds
the SQLite writer lock and cannot await a test suite. So `orchestration.send` (and the legacy
lifecycle path) runs verify first; a pass writes a single-use ticket to `factory_verify_results`,
which the transaction consumes. A newer verify supersedes older unspent tickets, so one pass can
never complete a later attempt. The worker's CLI call blocks during verify; its socket timeout is
`FACTORY_VERIFY_CLIENT_TIMEOUT_MS`.

**The gated agent cannot move the goalposts.**

- The command is read from the repo's primary checkout, never the worker's worktree, whose
  `orca.yaml` the worker can edit.
- Approval stores the command's hash; a changed command fails closed (`not_approved`) until a
  person re-approves. The runner executes the vetted text, not a re-read of the file.
- Approve and disable exist only as renderer IPC (`factoryGate:*`). RPC cannot tell a person from
  an agent, so no RPC method changes the gate.
- No observed exit (timeout, signal, spawn failure) is an `error`, never a pass.

## Landing never touches the base branch

`factory land` merges completed Tasks onto `factory/<run>` in dependency order. A gated Task
needs a passing verify; a Task that cannot land holds its dependents. On conflict the merge is
aborted and landing stops with the branch clean. After merging, verify runs once on the combined
branch, because each Task passing alone does not prove they pass together. Shipping
`factory/<run>` is a human review decision.

**Work must be committed.** Before running verify, the gate refuses a worktree with uncommitted
changes or untracked files (`.orca/` scratch excepted): land merges commits, so work left in the
working tree would pass verify and then vanish.

## Baseline decides how a run may be planned

`factory baseline` records the run's repo, limits, and fork commit (`factory_runs`), creates
`factory/<run>`, runs the repo setup script there (read from the primary checkout, like verify),
and runs verify (`factory_checks`, kind `baseline`). With any gate approved, `factory plan`
refuses a run without a baseline. A red baseline allows exactly one root task, because parallel
tasks would each fail the gate on errors none of them owns.

## Review is a separate worker, and Orca keeps the score

`factory review` runs only when the integration branch's current commit passed the combined
verify. It first fails the round itself if the diff touches `orca.yaml`, a guideline file, a
skill or overlay path, or secret-looking paths. Otherwise it creates a review task whose spec points at the guideline files
**in the primary checkout** (a branch cannot edit the rules it is judged by) and at the landed
tasks' acceptance criteria. The reviewer reports with `worker_done --report-path`. A report may still be
`{ verdict, summary, findings }`; those findings stay blocking. The two-axis report adds
`standards`, `spec`, `smells`, and `blastRadius`. A blocking standards finding, a spec criterion
that is missing or wrong, or a blast-radius item with no command and result fails the round.
Smells are recorded and shown, and they never fail it. Blocking items stay in `findings` so the
fix loop is unchanged; the full axes go in `factory_review_details`. On a run that snapshotted
skills, a build task's `worker_done --report-path` must contain `## Evidence`. "It compiles" is
not evidence. The verdict is recorded against the commit it reviewed, inside the existing
worker_done identity checks. Review tasks are excluded from the
build gate and from land. `factory fix` turns the latest failed round's findings into one fix
task. After `max_fix_rounds` failed rounds, both review and fix answer `factory_needs_human`.

Guideline files and limits (`factory_repo_settings`) are written only through renderer IPC.

## The PR is a person's click

`describeFactoryPrReadiness` requires: gate on, no open tasks, something landed, the latest
combined verify passed, and the latest decided review passed **at that same commit**. The
"Open draft PR" button calls `factoryGate:openPullRequest` (IPC only), which re-reads the
branch head and refuses if it moved or the worktree is dirty, then pushes `factory/<run>` — and
only that ref — to origin's **fetch** URL. A clone whose `remote.origin.pushurl` is disabled to
stop agents still gets this one explicit push. The PR is created as a draft through the repo's
forge provider; if that fails after the push, the dialog offers the compare page.

## Requests: intake, a brief, then the build

The sidebar's **Requests** sheet (`FactoryRequestsSheet.tsx`) lists requests. Opening one fills
the window with a chat (`FactoryRequestDetail.tsx`): plain status, the person's words, and one
decision at a time. Stages come from `factory-request-view.ts`. The transcript comes from
`factory-request-chat.ts` (`factory_messages`, questions, the brief, the plan).

A new request stores a title, description and agent (`factory_requests`). The main process
launches the coordinator (`factory-request-launch.ts`). Its prompt includes `prompts/intake.md`,
bundled as `INTAKE_PROMPT` in `factory-intake-prompt.ts`. Those two copies stay identical. The
coordinator does not baseline, plan, or write product code until the brief is approved.

Intake is on the request, before a run exists:

- `orca factory say --request <id>` posts a restatement (`factory_messages`).
- `orca factory ask --request <id>` stores one question with 2–4 choices, one recommended, and
  a one-line why (`factory_request_questions`). The prompt allows at most 3 questions in a turn
  and 4 turns, then the coordinator states its assumptions. `waiting` means ask again with
  `--question-id`.
- `orca factory brief --request <id> --file brief.json` submits
  `{ person, agent, kind, acceptance }` (`factory_briefs`). `person` is what the requester
  reads. `agent` is the build brief. `kind` is `app_only`, `needs_backend`, `app_and_backend`,
  `needs_native`, or `not_feasible`.
- `orca factory await-brief` long-polls. Approve and "change something" are IPC. APPROVED
  returns the agent brief, and the coordinator builds that text. CHANGES means submit again.

Only then: `orca factory baseline --request <id>` links the run, `orca factory plan` marks the
plan `awaiting` (`factory_plan_approvals`), and `orca factory await-approval` long-polls.
`assertFactoryWorkerCapacity` refuses every worker until both the brief and the plan are
approved. On "Ask for changes", the next plan retires the old unstarted tasks
(`factory:superseded`). Questions after a run exists still use `orca factory ask --run`
(`factory_questions`).

Answering, approving the brief, approving the plan, and cancelling are renderer IPC
(`factoryRequests:*`), never RPC, so an agent cannot answer or approve itself.

## Team rules: one set of rules for every laptop

With **team rules**, the gate, setup and guidelines come from the base branch's committed
`orca.yaml` instead of each laptop's working copy:

```yaml
scripts:
  setup: npm install
  verify: npx tsc --noEmit
factory:
  guidelines:
    - docs/code-conventions.md
  maxWorkers: 3
  maxFixRounds: 3
```

A person opts a repo in once ("Use team rules", `factoryGate:enableManaged`); the approval records
the base ref rather than a command hash, because changes to these rules arrive through reviewed
PRs. `factory baseline` fetches the base branch and snapshots the rules into `factory_run_configs`,
so a run keeps the rules it started with and builds `factory/<run>` from the fresh base ref. The
gate, the combined check and setup read the snapshot (`factory-managed-config.ts`); the reviewer
reads guideline files extracted from the pinned commit into a private temp folder.

## Limits

- Parallel workers per factory run are capped in the dispatch-start transaction
  (`assertFactoryWorkerCapacity`).
- `factory cleanup` removes worktrees of landed or reviewed tasks only when nothing but `.orca/`
  scratch and ignored files remain, and deletes their branches with `git branch -d` (merged only).
  Failed and unlanded tasks, and the integration worktree, are kept.

## Limits of this slice

- Local and WSL repos only. SSH workers are refused by the gate and by land (the relay's
  `git.exec` disallows `merge`), and federated dispatches are settled by their run home, so they
  are not gated here.
- One repo per run for landing.
- A runtime restart during verify surfaces to the worker as an unknown operation; resend
  `worker_done`.
- Agents run as the same OS user as Orca. The factory gives them no push path and the clicked
  push is the only one it makes, but an agent that deliberately invokes `git push <url>` with
  the user's credentials is outside what Orca can prevent; protect the base branch on the forge.
