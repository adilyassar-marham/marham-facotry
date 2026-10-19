import { gitExecFileAsync } from '../../../git/runner'
import { gitOptionsForWorktree } from '../../../git/git-runtime-options'

export type FactoryGitRun = { ok: boolean; stdout: string; stderr: string }
export type FactoryGitRunner = (
  args: string[],
  cwd: string,
  wslDistro?: string
) => Promise<FactoryGitRun>

function readStream(error: unknown, key: 'stdout' | 'stderr'): string {
  if (typeof error === 'object' && error !== null && key in error) {
    const value: unknown = Object.getOwnPropertyDescriptor(error, key)?.value
    return typeof value === 'string' ? value : ''
  }
  return ''
}

export const runLocalGit: FactoryGitRunner = async (args, cwd, wslDistro) => {
  try {
    const result = await gitExecFileAsync(args, gitOptionsForWorktree(cwd, { wslDistro }))
    return { ok: true, ...result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      stdout: readStream(error, 'stdout'),
      stderr: readStream(error, 'stderr') || message
    }
  }
}

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

/** `.orca/` holds factory scratch (plans, review reports) that is never meant to be committed. */
const FACTORY_SCRATCH = /^.. \.orca\//

/**
 * Work a worker would lose at land time: tracked edits and new files it never committed.
 * Null means git could not answer, which callers treat as "not clean".
 */
export async function listUncommittedChanges(
  git: FactoryGitRunner,
  cwd: string,
  wslDistro?: string
): Promise<string[] | null> {
  const status = await git(['status', '--porcelain', '--untracked-files=normal'], cwd, wslDistro)
  if (!status.ok) {
    return null
  }
  return lines(status.stdout).filter((line) => !FACTORY_SCRATCH.test(line))
}

export async function readHeadSha(
  git: FactoryGitRunner,
  cwd: string,
  wslDistro?: string
): Promise<string | null> {
  const head = await git(['rev-parse', 'HEAD'], cwd, wslDistro)
  return head.ok ? head.stdout.trim() || null : null
}

/** Commits on `branch` that `cwd`'s HEAD lacks; null when either ref is unreadable. */
export async function countCommitsToMerge(
  git: FactoryGitRunner,
  cwd: string,
  branch: string,
  wslDistro?: string
): Promise<number | null> {
  const count = await git(['rev-list', '--count', `HEAD..${branch}`], cwd, wslDistro)
  const parsed = count.ok ? Number.parseInt(count.stdout.trim(), 10) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

/** Added plus deleted lines between `base` and HEAD. Binary rows are skipped. */
export async function countChangedLines(
  git: FactoryGitRunner,
  cwd: string,
  base: string,
  wslDistro?: string
): Promise<number> {
  const diff = await git(['diff', '--numstat', `${base}...HEAD`], cwd, wslDistro)
  if (!diff.ok) {
    return 0
  }
  let total = 0
  for (const line of diff.stdout.split('\n')) {
    const [added, deleted] = line.split('\t')
    const additions = Number.parseInt(added ?? '', 10)
    const deletions = Number.parseInt(deleted ?? '', 10)
    if (Number.isFinite(additions)) {
      total += additions
    }
    if (Number.isFinite(deletions)) {
      total += deletions
    }
  }
  return total
}

/** Files the integration branch changes relative to where it forked from `base`. */
export async function listChangedFiles(
  git: FactoryGitRunner,
  cwd: string,
  base: string,
  wslDistro?: string
): Promise<string[] | null> {
  const diff = await git(['diff', '--name-only', `${base}...HEAD`], cwd, wslDistro)
  return diff.ok ? lines(diff.stdout) : null
}

export async function readCurrentBranch(
  git: FactoryGitRunner,
  cwd: string,
  wslDistro?: string
): Promise<string | null> {
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, wslDistro)
  const name = branch.ok ? branch.stdout.trim() : ''
  return name && name !== 'HEAD' ? name : null
}
