# Orca Software Factory

This file is a discovery stub, not the usage guide. The full, version-matched Orca
factory reference is served by the `orca` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage the Orca factory when asked to plan and build a goal end to end: decompose a
goal, PRD, or ticket into a task graph with acceptance criteria, dispatch supervised
workers, let the repo's approved verify gate judge every task, and land verified work
onto one integration branch for human review. It builds on Orca orchestration; never
substitute a non-Orca subagent tool.

<!-- shared: resolver -->

## Load the version-matched guide before running Orca commands

```text
ORCA skills get factory
```

That prints the compact, version-matched guide for the exact binary that will handle
your next commands.

<!-- shared: no-guessing -->
