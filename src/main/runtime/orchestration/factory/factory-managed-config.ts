import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { getEffectiveHooks } from '../../../hooks'
import { getDefaultBaseRef } from '../../../source-control/hosted-review-creation-git-state'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import {
  parseCommittedFactoryConfig,
  type CommittedFactoryConfig
} from '../../../../shared/factory-config'
import type { Repo } from '../../../../shared/repo-types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import type { FactoryGateApprovalRow, FactoryRunConfigRow } from '../db/factory/factory-row-types'
import { runLocalGit, type FactoryGitRunner } from './factory-git'
import { readShippedFactoryScripts } from './factory-shipped-config'
import { hashFactoryVerifyCommand, readFactoryVerifyCommand } from './factory-verify-command'

/** An approval whose rules come from the base branch rather than a command a person approved. */
export const MANAGED_GATE_HASH = 'managed'

export function isManagedGate(
  approval: Pick<FactoryGateApprovalRow, 'content_hash'> | undefined
): boolean {
  return approval?.content_hash === MANAGED_GATE_HASH
}

export type CommittedFactoryRules = {
  baseRef: string
  commit: string
  config: CommittedFactoryConfig
}

/**
 * The team's rules as committed on the base branch. Fetches first when asked, so a laptop whose
 * local branches are weeks old still runs today's rules.
 */
export async function readCommittedFactoryRules(
  repo: Repo,
  options: { fetch: boolean; git?: FactoryGitRunner }
): Promise<CommittedFactoryRules | null> {
  const git = options.git ?? runLocalGit
  const baseRef =
    (await getDefaultBaseRef(repo.path, LOCAL_EXECUTION_HOST_ID).catch(() => null)) ?? 'origin/HEAD'
  if (options.fetch && baseRef.startsWith('origin/')) {
    // Best effort: offline still works from the last fetched copy of the rules.
    await git(['fetch', 'origin', baseRef.slice('origin/'.length)], repo.path)
  }
  const commit = await git(['rev-parse', '--verify', `${baseRef}^{commit}`], repo.path)
  if (!commit.ok) {
    return null
  }
  const sha = commit.stdout.trim()
  const file = await git(['show', `${sha}:orca.yaml`], repo.path)
  const config = file.ok ? parseCommittedFactoryConfig(file.stdout) : null
  return config ? { baseRef, commit: sha, config } : null
}

/** Pins a managed run to the rules on the base branch now; later runs pick up later rules. */
export async function snapshotFactoryRunConfig(
  db: OrchestrationDb,
  params: { runId: string; repo: Repo },
  git?: FactoryGitRunner
): Promise<FactoryRunConfigRow> {
  const existing = db.getFactoryRunConfig(params.runId)
  if (existing) {
    return existing
  }
  const rules = await readCommittedFactoryRules(params.repo, { fetch: true, git })
  if (!rules) {
    throw new OrchestrationError(
      'factory_rules_missing',
      'This project uses team rules, but the base branch has no orca.yaml with a `factory:` ' +
        'section and `scripts.verify`. An engineer needs to commit them.'
    )
  }
  return db.recordFactoryRunConfig({
    run_id: params.runId,
    base_ref: rules.baseRef,
    base_commit: rules.commit,
    verify: rules.config.verify,
    setup: rules.config.setup,
    guidelines: JSON.stringify(rules.config.guidelines),
    max_workers: rules.config.maxWorkers,
    max_fix_rounds: rules.config.maxFixRounds
  })
}

export type FactoryVerifyCommandResolution =
  | { ok: true; command: string }
  | { ok: false; why: string }

/** One answer for every gate: the run's committed rules, or the command a person approved. */
export function resolveFactoryVerifyCommand(
  db: OrchestrationDb,
  params: { repo: Repo; approval: FactoryGateApprovalRow; runId: string | undefined }
): FactoryVerifyCommandResolution {
  if (isManagedGate(params.approval)) {
    const config = params.runId ? db.getFactoryRunConfig(params.runId) : undefined
    return config
      ? { ok: true, command: config.verify }
      : {
          ok: false,
          why: 'This run has no team-rules snapshot. Run `orca factory baseline` for it first.'
        }
  }
  const command = readFactoryVerifyCommand(params.repo.path)
  if (!command || hashFactoryVerifyCommand(command) !== params.approval.content_hash) {
    return {
      ok: false,
      why:
        'The `scripts.verify` command in orca.yaml was removed or changed since it was approved. ' +
        'A person must re-approve it in Settings → Orchestration → Factory before tasks can complete.'
    }
  }
  return { ok: true, command }
}

export function resolveFactorySetupScript(
  db: OrchestrationDb,
  repo: Repo,
  runId: string
): string | null {
  const config = db.getFactoryRunConfig(runId)
  if (config) {
    return config.setup
  }
  return (
    getEffectiveHooks(repo)?.scripts.setup?.trim() ||
    readShippedFactoryScripts(repo.path)?.setup ||
    null
  )
}

export function parseGuidelineList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

/**
 * Copies a managed run's guideline files out of its pinned commit into a private folder, so the
 * reviewer reads exactly what was reviewed into the base branch — never a working copy.
 */
export async function extractRunGuidelines(
  db: OrchestrationDb,
  params: { runId: string; repo: Repo },
  git: FactoryGitRunner = runLocalGit
): Promise<{ paths: string[]; files: string[] } | null> {
  const config = db.getFactoryRunConfig(params.runId)
  if (!config) {
    return null
  }
  const paths = parseGuidelineList(config.guidelines)
  const dir = await mkdtemp(join(tmpdir(), 'orca-factory-guidelines-'))
  const files: string[] = []
  for (const path of paths) {
    const shown = await git(['show', `${config.base_commit}:${path}`], params.repo.path)
    if (shown.ok) {
      const target = join(dir, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, shown.stdout, 'utf8')
      files.push(target)
    }
  }
  return { paths, files }
}
