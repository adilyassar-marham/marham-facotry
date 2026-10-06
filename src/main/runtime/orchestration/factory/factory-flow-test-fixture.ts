import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repo } from '../../../../shared/repo-types'
import type { OrchestrationDb } from '../db'
import { reattachDispatchConsumer } from '../db/root-dispatch-test-fixture'
import type { FactoryCleanupHost } from './factory-cleanup'
import type { FactoryIntegrationHost } from './factory-integration'
import type { FactoryScriptRunner } from './factory-verify'
import { hashFactoryVerifyCommand } from './factory-verify-command'

export const VERIFY_COMMAND = 'npx tsc --noEmit'

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** A real repo with a bare `origin` whose push URL is disabled, like a locked-down clone. */
export function createFactoryRepo(): { root: string; repo: Repo; remote: string } {
  const root = mkdtempSync(join(tmpdir(), 'orca-factory-flow-'))
  const path = join(root, 'repo')
  const remote = join(root, 'remote.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['init', '-q', '-b', 'main', path])
  git(path, 'config', 'user.email', 'factory@test.local')
  git(path, 'config', 'user.name', 'Factory Test')
  writeFileSync(join(path, 'app.ts'), 'export const app = 1\n')
  git(path, 'add', '.')
  git(path, 'commit', '-qm', 'base')
  git(path, 'remote', 'add', 'origin', remote)
  git(path, 'push', '-q', 'origin', 'main')
  git(path, 'config', 'remote.origin.pushurl', 'DISABLED')
  // Untracked on purpose: guidelines and orca.yaml are read from the primary checkout only.
  writeFileSync(join(path, 'orca.yaml'), `scripts:\n  setup: npm ci\n  verify: ${VERIFY_COMMAND}\n`)
  mkdirSync(join(path, '.cursor', 'rules'), { recursive: true })
  writeFileSync(join(path, '.cursor', 'rules', 'code.mdc'), '# Rules\n1. Minimal code\n')
  const repo: Repo = { id: 'repo_flow', path, displayName: 'app', badgeColor: '', addedAt: 0 }
  return { root, repo, remote }
}

export function approveGate(db: OrchestrationDb, repo: Repo): void {
  db.approveFactoryGate({
    repoId: repo.id,
    contentHash: hashFactoryVerifyCommand(VERIFY_COMMAND),
    command: VERIFY_COMMAND,
    timeoutSeconds: 60
  })
}

export const passingRunner: FactoryScriptRunner = async () => ({
  success: true,
  output: 'ok',
  exitCode: 0
})

export function createFactoryHost(
  root: string,
  repo: Repo
): FactoryIntegrationHost &
  FactoryCleanupHost & { addWorktree(branch: string, from: string): string } {
  const worktrees = new Map<string, string>([[`${repo.id}::${repo.path}`, repo.path]])
  return {
    addWorktree(branch, from) {
      const path = join(root, `wt-${branch.replace(/\//g, '-')}`)
      git(repo.path, 'worktree', 'add', '-q', '-b', branch, path, from)
      const id = `${repo.id}::${path}`
      worktrees.set(id, path)
      return id
    },
    resolveFactoryWorktreeTarget: async (selector) => {
      const path = worktrees.get(selector.slice('id:'.length))
      if (!path) {
        throw new Error(`unknown worktree ${selector}`)
      }
      return {
        worktree: { path, branch: git(path, 'rev-parse', '--abbrev-ref', 'HEAD') },
        repo,
        executionHostId: 'local'
      }
    },
    createFactoryIntegrationWorktree: async ({ branch, baseBranch }) => {
      const path = join(root, 'integration')
      git(repo.path, 'worktree', 'add', '-q', '-b', branch, path, baseBranch ?? 'main')
      const id = `${repo.id}::${path}`
      worktrees.set(id, path)
      return { id, path }
    },
    removeFactoryWorktree: async (worktreeId) => {
      const path = worktrees.get(worktreeId)
      if (path) {
        git(repo.path, 'worktree', 'remove', '--force', path)
        worktrees.delete(worktreeId)
      }
    }
  }
}

/** Starts a worker on `worktreeId` and returns its dispatch, like `worker-start` would. */
export function startFactoryWorker(
  db: OrchestrationDb,
  taskId: string,
  worktreeId: string
): string {
  const started = db.createStartingWorkerDispatch({
    creator: { kind: 'system' },
    maxDepth: Number.MAX_SAFE_INTEGER,
    taskId,
    startOptions: {}
  })
  reattachDispatchConsumer(db, {
    dispatchId: started.dispatch.id,
    paneKey: `tab_worker:${taskId}`,
    processIncarnation: `runtime_test:${taskId}:1`
  })
  db.recordWorkerStage({ dispatchId: started.dispatch.id, stage: 'running', worktreeId })
  return started.dispatch.id
}

export function commitFile(worktreePath: string, file: string, content: string): void {
  writeFileSync(join(worktreePath, file), content)
  git(worktreePath, 'add', '.')
  git(worktreePath, 'commit', '-qm', `edit ${file}`)
}
