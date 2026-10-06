import { getForgeProviderForRepository } from '../../../source-control/forge-provider'
import { getDefaultBaseRef } from '../../../source-control/hosted-review-creation-git-state'
import { normalizeHostedReviewBaseRef } from '../../../../shared/hosted-review-refs'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { CreateHostedReviewResult } from '../../../../shared/hosted-review'
import type { FactoryOpenPrResult } from '../../../../shared/factory-run-types'
import type { Repo } from '../../../../shared/repo-types'
import type { OrchestrationDb } from '../db'
import {
  listUncommittedChanges,
  readHeadSha,
  runLocalGit,
  type FactoryGitRunner
} from './factory-git'
import { buildFactoryPrBody, defaultFactoryPrTitle } from './factory-pr-body'
import { resolveFactoryRepoSettings } from './factory-repo-settings'
import { describeFactoryPrReadiness } from './factory-run-report'
import { readFactoryVerifyCommand } from './factory-verify-command'

export type FactoryReviewCreator = (args: {
  worktreePath: string
  base: string
  head: string
  title: string
  body: string
}) => Promise<CreateHostedReviewResult>

const createDraftReview: FactoryReviewCreator = async (args) => {
  const provider = await getForgeProviderForRepository({
    repoPath: args.worktreePath,
    executionHostId: LOCAL_EXECUTION_HOST_ID
  })
  if (!provider?.createReview) {
    return { ok: false, code: 'unsupported_provider', error: 'This repo’s remote cannot take PRs.' }
  }
  return provider.createReview(
    args.worktreePath,
    {
      provider: provider.id,
      base: args.base,
      head: args.head,
      title: args.title,
      body: args.body,
      draft: true
    },
    LOCAL_EXECUTION_HOST_ID
  )
}

function compareUrl(remoteUrl: string, base: string, head: string): string | null {
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl.trim())
  return match
    ? `https://github.com/${match[1]}/${match[2]}/compare/${base}...${head}?expand=1`
    : null
}

/**
 * The only path from a factory run to the remote, reachable from Orca's UI alone. It pushes to
 * origin's fetch URL on purpose: a person who disabled `pushurl` to stop agents still gets this
 * one explicit, clicked push of the integration branch — never the base branch.
 */
export async function openFactoryPullRequest(
  db: OrchestrationDb,
  repo: Repo,
  params: { runId: string; title?: string },
  deps: { git?: FactoryGitRunner; createReview?: FactoryReviewCreator } = {}
): Promise<FactoryOpenPrResult> {
  const git = deps.git ?? runLocalGit
  const refuse = (error: string): FactoryOpenPrResult => ({
    ok: false,
    pushed: false,
    error,
    compareUrl: null
  })
  const readiness = describeFactoryPrReadiness(db, params.runId)
  const integration = db.getFactoryIntegration(params.runId)
  const check = db.getLatestFactoryCheck(params.runId, 'integration')
  if (!readiness.ready || !integration || !check) {
    return refuse(readiness.reasons.join(' ') || 'This run is not ready for a PR.')
  }
  if (integration.repo_id !== repo.id) {
    return refuse('This run belongs to another repo.')
  }
  const cwd = integration.worktree_path
  const headSha = await readHeadSha(git, cwd)
  if (headSha !== check.head_sha) {
    return refuse('The integration branch moved since it was verified and reviewed. Land again.')
  }
  const dirty = await listUncommittedChanges(git, cwd)
  if (dirty === null || dirty.length > 0) {
    return refuse('The integration worktree has uncommitted changes; they would not be in the PR.')
  }
  const remote = await git(['remote', 'get-url', 'origin'], cwd)
  const remoteUrl = remote.stdout.trim()
  if (!remote.ok || !remoteUrl) {
    return refuse('This repo has no origin remote to open a PR against.')
  }
  const run = db.getFactoryRun(params.runId)
  const defaultBase = await getDefaultBaseRef(repo.path, LOCAL_EXECUTION_HOST_ID).catch(() => null)
  const base = normalizeHostedReviewBaseRef(run?.base_branch ?? defaultBase ?? 'main')
  const head = integration.integration_branch
  const push = await git(['push', remoteUrl, `refs/heads/${head}:refs/heads/${head}`], cwd)
  if (!push.ok) {
    return refuse(`Push failed: ${push.stderr.trim().split('\n').slice(-3).join(' ')}`)
  }
  const settings = resolveFactoryRepoSettings(db, repo)
  const objective = db.getRun(params.runId)?.objective ?? null
  const created = await (deps.createReview ?? createDraftReview)({
    worktreePath: cwd,
    base,
    head,
    title: params.title?.trim() || defaultFactoryPrTitle(objective, params.runId),
    body: buildFactoryPrBody(db, {
      runId: params.runId,
      objective,
      verifyCommand: readFactoryVerifyCommand(repo.path) ?? '(unknown)',
      guidelines: settings.guidelines
    })
  })
  // Why: a PR someone already opened for this branch is the run's PR, not a failure.
  const opened = created.ok ? created : created.existingReview
  if (!opened) {
    return {
      ok: false,
      pushed: true,
      error: created.ok ? '' : created.error,
      compareUrl: compareUrl(remoteUrl, base, head)
    }
  }
  db.recordFactoryPullRequest({
    run_id: params.runId,
    url: opened.url,
    number: opened.number ?? null,
    head_branch: head,
    base_branch: base,
    head_sha: headSha
  })
  const pullRequest = db.getFactoryPullRequest(params.runId)
  return pullRequest
    ? {
        ok: true,
        pullRequest: {
          url: pullRequest.url,
          number: pullRequest.number,
          headBranch: pullRequest.head_branch,
          baseBranch: pullRequest.base_branch,
          headSha: pullRequest.head_sha,
          openedAt: pullRequest.opened_at
        }
      }
    : refuse('The PR opened but Orca could not record it.')
}
