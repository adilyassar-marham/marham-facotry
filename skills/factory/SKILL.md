---
name: factory
description: >-
  Run Marham Factory: turn a goal, PRD, or ticket into a dependency
  graph of small tasks with acceptance criteria, dispatch supervised workers,
  let the repo's approved verify gate judge every "done", land verified work
  onto one factory integration branch, and loop a guideline review with
  fixes until it passes, so a person can open the PR. Use when asked to "plan
  and build", "use the factory", "decompose and ship", or run many tasks end to
  end. Builds on the orchestration skill for dispatch.
---

# Marham Factory

This file is a discovery stub, not the usage guide. The full, version-matched Marham
Factory reference is served by the `orca` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage Marham Factory when asked to plan and build a goal end to end: split the goal
into separate tasks, one agent each, with acceptance criteria, dispatch those agents,
let the approved verify gate judge every task, land verified work onto one integration
branch, and loop a guideline review with fixes until a person can open the PR.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `ORCA_CLI_COMMAND` environment variable is set, use its value. Orca exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `ORCA_DEV_REPO_ROOT`, use `orca-dev`.
- Otherwise, on Linux outside an Orca-managed terminal, use `orca-ide`. Never run bare
  `orca` there — outside Orca's terminals it normally resolves to the
  GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `orca`.

Below, `ORCA` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `ORCA` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Orca build.

## Load the version-matched guide before running Orca commands

```text
ORCA skills get factory
```

That prints the compact, version-matched guide for the exact binary that will handle
your next commands.

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Orca is not running, start it with `ORCA open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `ORCA open` or restart Orca. If
`skills get` is unknown, explain that updating Orca restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
