import type { FactoryVerifySummary } from '../../../../shared/factory-types'
import type { Repo } from '../../../../shared/repo-types'
import type { OrchestrationDb } from '../db'
import {
  hashFactoryVerifyCommand,
  readFactoryVerifyCommand,
  tailFactoryVerifyOutput
} from './factory-verify-command'
import { runApprovedScript, type FactoryScriptRunner } from './factory-verify'

/**
 * Each Task passed alone; this proves they pass together. Not a completion door, so it leaves no
 * ticket — the result is reported to whoever ran the land.
 */
export async function runFactoryIntegrationVerify(
  db: OrchestrationDb,
  params: { repo: Repo; cwd: string; wslDistro?: string; runner?: FactoryScriptRunner }
): Promise<FactoryVerifySummary | null> {
  const approval = db.getFactoryGateApproval(params.repo.id)
  if (!approval) {
    return null
  }
  const startedAt = Date.now()
  const summary = (
    status: FactoryVerifySummary['status'],
    exitCode: number | null,
    output: string
  ): FactoryVerifySummary => ({
    id: `integration:${startedAt}`,
    status,
    exitCode,
    timedOut: /timed out after/i.test(output),
    durationMs: Date.now() - startedAt,
    outputTail: tailFactoryVerifyOutput(output),
    completedAt: new Date().toISOString()
  })
  const command = readFactoryVerifyCommand(params.repo.path)
  if (!command || hashFactoryVerifyCommand(command) !== approval.content_hash) {
    return summary('not_approved', null, 'The verify command changed since it was approved.')
  }
  const run = await (params.runner ?? runApprovedScript)({
    script: command,
    cwd: params.cwd,
    repo: params.repo,
    wslDistro: params.wslDistro,
    timeoutMs: approval.timeout_seconds * 1000
  }).catch((error: unknown) => ({
    success: false,
    output: error instanceof Error ? error.message : String(error),
    exitCode: undefined
  }))
  const status = run.success ? 'passed' : run.exitCode === undefined ? 'error' : 'failed'
  return summary(status, run.exitCode ?? null, run.output)
}
