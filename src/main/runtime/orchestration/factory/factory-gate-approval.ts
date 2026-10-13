import { LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { FactoryGateStatus } from '../../../../shared/factory-types'
import type { Repo } from '../../../../shared/repo-types'
import type { OrchestrationDb } from '../db'
import {
  isManagedGate,
  MANAGED_GATE_HASH,
  readCommittedFactoryRules
} from './factory-managed-config'
import { resolveFactoryRepoSettings } from './factory-repo-settings'
import { readShippedFactoryScripts } from './factory-shipped-config'
import {
  clampFactoryVerifyTimeoutSeconds,
  hashFactoryVerifyCommand,
  readFactoryVerifyCommand
} from './factory-verify-command'

/** Turns the shipped check on once. A person who switched it off stays off until they enable it. */
export function ensureShippedFactoryGate(db: OrchestrationDb, repo: Repo): void {
  if (getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID || repo.kind === 'folder') {
    return
  }
  if (db.getFactoryGateApproval(repo.id) || db.isFactoryGateDeclined(repo.id)) {
    return
  }
  const shipped = readShippedFactoryScripts(repo.path)
  const command = readFactoryVerifyCommand(repo.path)
  if (!shipped || command !== shipped.verify) {
    return
  }
  db.approveFactoryGate({
    repoId: repo.id,
    contentHash: hashFactoryVerifyCommand(shipped.verify),
    command: shipped.verify,
    timeoutSeconds: clampFactoryVerifyTimeoutSeconds(undefined)
  })
}

function unsupportedReason(repo: Repo, command: string | undefined): string | null {
  if (getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID) {
    return 'The factory gate supports local and WSL repos only.'
  }
  if (repo.kind === 'folder') {
    return 'The factory gate needs a git repo; folder workspaces have no task branches.'
  }
  return command ? null : 'Add `scripts.verify` to this repo’s orca.yaml to enable the gate.'
}

export function describeFactoryGate(db: OrchestrationDb, repo: Repo): FactoryGateStatus {
  ensureShippedFactoryGate(db, repo)
  const remote = getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID
  // Why: never read a remote repo's path from the local disk; it names a path on another host.
  const command = remote ? undefined : readFactoryVerifyCommand(repo.path)
  const approval = db.getFactoryGateApproval(repo.id)
  const managed = isManagedGate(approval)
  const shipped = remote ? null : readShippedFactoryScripts(repo.path)
  return {
    repoId: repo.id,
    repoName: repo.displayName,
    command: command ?? null,
    builtin: Boolean(shipped) && command === shipped?.verify && !managed,
    enabled: Boolean(approval),
    // Why: team rules change through reviewed commits to the base branch, never by local edits.
    stale:
      Boolean(approval) &&
      !managed &&
      (!command || hashFactoryVerifyCommand(command) !== approval?.content_hash),
    timeoutSeconds: approval?.timeout_seconds ?? null,
    approvedAt: approval?.approved_at ?? null,
    unsupportedReason: managed ? null : unsupportedReason(repo, command),
    settings: resolveFactoryRepoSettings(db, repo, { detect: !remote }),
    managedBaseRef: managed ? (approval?.command ?? null) : null,
    teamRules: null
  }
}

/**
 * Turns on the gate with the team's committed rules. The person approves where rules come from
 * (the base branch, changed only through reviewed PRs), not each command, so non-engineers can
 * opt in safely.
 */
export async function enableManagedFactoryGate(
  db: OrchestrationDb,
  repo: Repo
): Promise<FactoryGateStatus> {
  if (getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID || repo.kind === 'folder') {
    throw new Error('Team rules work with local git repos only.')
  }
  const rules = await readCommittedFactoryRules(repo, { fetch: true })
  if (!rules) {
    throw new Error(
      'The base branch has no orca.yaml with a `factory:` section and `scripts.verify`. An engineer needs to commit the team rules first.'
    )
  }
  db.approveFactoryGate({
    repoId: repo.id,
    contentHash: MANAGED_GATE_HASH,
    command: rules.baseRef,
    timeoutSeconds: clampFactoryVerifyTimeoutSeconds(undefined)
  })
  return describeFactoryGate(db, repo)
}

/**
 * The approval is the trust decision, so it is reachable only from Orca's own UI over IPC — never
 * over RPC, where the gated agent itself could call it.
 */
export function enableFactoryGate(
  db: OrchestrationDb,
  repo: Repo,
  params: { expectedCommand: string; timeoutSeconds?: number }
): FactoryGateStatus {
  const status = describeFactoryGate(db, repo)
  if (status.unsupportedReason || !status.command) {
    throw new Error(status.unsupportedReason ?? 'No verify command to approve.')
  }
  // Why: approve what the person saw; if orca.yaml changed while the dialog was open, refuse.
  if (status.command !== params.expectedCommand.trim()) {
    throw new Error('orca.yaml changed while you were reviewing it. Review the new command first.')
  }
  db.clearFactoryGateDecline(repo.id)
  db.approveFactoryGate({
    repoId: repo.id,
    contentHash: hashFactoryVerifyCommand(status.command),
    command: status.command,
    timeoutSeconds: clampFactoryVerifyTimeoutSeconds(params.timeoutSeconds)
  })
  return describeFactoryGate(db, repo)
}

export function disableFactoryGate(db: OrchestrationDb, repo: Repo): FactoryGateStatus {
  const shipped = readShippedFactoryScripts(repo.path)
  const command = readFactoryVerifyCommand(repo.path)
  if (shipped && command === shipped.verify) {
    db.declineFactoryGate(repo.id)
  }
  db.revokeFactoryGate(repo.id)
  return describeFactoryGate(db, repo)
}
