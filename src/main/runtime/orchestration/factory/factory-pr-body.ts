import type { OrchestrationDb } from '../db'
import { summarizeFactoryReview } from './factory-run-report'

const short = (sha: string): string => sha.slice(0, 8)

export function defaultFactoryPrTitle(objective: string | null, runId: string): string {
  const first = (objective ?? '').split('\n')[0].trim()
  const title = first || `Factory run ${runId}`
  return title.length > 72 ? `${title.slice(0, 69)}...` : title
}

/** Written for a reviewer who never saw the run: what changed, what checked it, what is missing. */
export function buildFactoryPrBody(
  db: OrchestrationDb,
  params: { runId: string; objective: string | null; verifyCommand: string; guidelines: string[] }
): string {
  const landings = new Map(
    db.listFactoryLandings(params.runId).map((landing) => [landing.task_id, landing])
  )
  const reviewTasks = new Set(db.listFactoryReviews(params.runId).map((review) => review.task_id))
  const tasks = db.listTasks({ runId: params.runId }).filter((task) => !reviewTasks.has(task.id))
  const title = (task: (typeof tasks)[number]): string => task.task_title ?? task.id
  const landed = tasks.filter((task) => landings.has(task.id))
  const missing = tasks.filter((task) => !landings.has(task.id))
  const check = db.getLatestFactoryCheck(params.runId, 'integration')
  const reviews = db.listFactoryReviews(params.runId).filter((row) => row.verdict !== 'pending')
  const passed = reviews.at(-1)
  return [
    '## What this changes',
    params.objective?.trim() || '(no objective recorded)',
    '',
    '## Tasks',
    ...landed.map((task) => {
      const landing = landings.get(task.id)
      return `- ${title(task)} — merged as ${landing ? short(landing.merge_commit) : '?'}`
    }),
    ...(missing.length > 0
      ? ['', '## Not included', ...missing.map((task) => `- ${title(task)} (${task.status})`)]
      : []),
    '',
    '## How it was checked',
    `- Every task passed \`${params.verifyCommand}\` in its own worktree before it could finish.`,
    check
      ? `- The combined branch passed it again at ${short(check.head_sha)}.`
      : '- The combined branch was not re-verified.',
    passed
      ? `- Guideline review round ${passed.round} passed: ${summarizeFactoryReview(passed).summary}`
      : '- No guideline review recorded.',
    `- Review rounds that failed and were fixed: ${reviews.filter((row) => row.verdict === 'fail').length}.`,
    ...(params.guidelines.length > 0
      ? ['- Guidelines checked:', ...params.guidelines.map((path) => `  - ${path}`)]
      : []),
    '',
    '---',
    'Opened as a draft from Orca’s software factory after a person clicked “Open draft PR”.'
  ].join('\n')
}
