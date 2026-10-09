# Marham Factory

This file is a discovery stub, not the usage guide. The full, version-matched Marham
Factory reference is served by the `orca` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage Marham Factory when asked to plan and build a goal end to end: split the goal
into separate tasks, one agent each, with acceptance criteria, dispatch those agents,
let the approved verify gate judge every task, land verified work onto one integration
branch, and loop a guideline review with fixes until a person can open the PR.

<!-- shared: resolver -->

## Load the version-matched guide before running Orca commands

```text
ORCA skills get factory
```

That prints the compact, version-matched guide for the exact binary that will handle
your next commands.

<!-- shared: no-guessing -->
