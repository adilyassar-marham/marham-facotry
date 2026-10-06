import { LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { FactoryGateStatus } from '../../../../shared/factory-types'
import type { Repo } from '../../../../shared/repo-types'
import type { OrchestrationDb } from '../db'
import {
  clampFactoryVerifyTimeoutSeconds,
  hashFactoryVerifyCommand,
  readFactoryVerifyCommand
} from './factory-verify-command'

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
  const remote = getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID
  // Why: never read a remote repo's path from the local disk; it names a path on another host.
  const command = remote ? undefined : readFactoryVerifyCommand(repo.path)
  const approval = db.getFactoryGateApproval(repo.id)
  return {
    repoId: repo.id,
    repoName: repo.displayName,
    command: command ?? null,
    enabled: Boolean(approval),
    stale:
      Boolean(approval) &&
      (!command || hashFactoryVerifyCommand(command) !== approval?.content_hash),
    timeoutSeconds: approval?.timeout_seconds ?? null,
    approvedAt: approval?.approved_at ?? null,
    unsupportedReason: unsupportedReason(repo, command)
  }
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
  db.approveFactoryGate({
    repoId: repo.id,
    contentHash: hashFactoryVerifyCommand(status.command),
    command: status.command,
    timeoutSeconds: clampFactoryVerifyTimeoutSeconds(params.timeoutSeconds)
  })
  return describeFactoryGate(db, repo)
}

export function disableFactoryGate(db: OrchestrationDb, repo: Repo): FactoryGateStatus {
  db.revokeFactoryGate(repo.id)
  return describeFactoryGate(db, repo)
}
