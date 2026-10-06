import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { FactoryReviewFinding } from '../../../../shared/factory-run-types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import type { FactoryVerifyHost } from './factory-verify'

const MAX_REPORT_BYTES = 256 * 1024
const MAX_FINDINGS = 100
const MAX_TEXT = 2000

export const FACTORY_REVIEW_REPORT_SHAPE =
  '{ "verdict": "pass" | "fail", "summary": "<one paragraph>", "findings": [{ "rule": "<rule name>", ' +
  '"file": "<path>", "line": 12, "problem": "<what breaks the rule>", "fix": "<what to change>" }] }'

type ParsedReport = { verdict: 'pass' | 'fail'; summary: string; findings: FactoryReviewFinding[] }

function refuse(message: string): OrchestrationError {
  return new OrchestrationError(
    'factory_review_report_invalid',
    `${message}\nWrite the review as JSON shaped like ${FACTORY_REVIEW_REPORT_SHAPE}, then send ` +
      'worker_done --outcome succeeded --report-path <that file> again.'
  )
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : ''

function parseFinding(raw: unknown, index: number): FactoryReviewFinding {
  if (typeof raw !== 'object' || raw === null) {
    throw refuse(`findings[${index}] is not an object.`)
  }
  const field = (key: string): unknown => Object.getOwnPropertyDescriptor(raw, key)?.value
  const rule = text(field('rule'))
  const problem = text(field('problem'))
  if (!rule || !problem) {
    throw refuse(`findings[${index}] needs both "rule" and "problem".`)
  }
  const line = field('line')
  return {
    rule,
    problem,
    ...(text(field('file')) ? { file: text(field('file')) } : {}),
    ...(typeof line === 'number' && Number.isInteger(line) && line > 0 ? { line } : {}),
    ...(text(field('fix')) ? { fix: text(field('fix')) } : {})
  }
}

export function parseFactoryReviewReport(raw: string): ParsedReport {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw refuse('The review report is not valid JSON.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw refuse('The review report must be a JSON object.')
  }
  const field = (key: string): unknown => Object.getOwnPropertyDescriptor(parsed, key)?.value
  const verdict = field('verdict')
  if (verdict !== 'pass' && verdict !== 'fail') {
    throw refuse('"verdict" must be "pass" or "fail".')
  }
  const summary = text(field('summary'))
  if (!summary) {
    throw refuse('"summary" is required.')
  }
  const rawFindings = field('findings') ?? []
  if (!Array.isArray(rawFindings) || rawFindings.length > MAX_FINDINGS) {
    throw refuse(`"findings" must be an array of at most ${MAX_FINDINGS} items.`)
  }
  const findings = rawFindings.map(parseFinding)
  // Why: a pass that lists violations, or a fail that names none, cannot drive the fix loop.
  if (verdict === 'fail' && findings.length === 0) {
    throw refuse('A "fail" verdict must list at least one finding.')
  }
  if (verdict === 'pass' && findings.length > 0) {
    throw refuse('A "pass" verdict must have an empty findings list; any finding means "fail".')
  }
  return { verdict, summary, findings }
}

async function readReport(path: string): Promise<string> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_REPORT_BYTES) {
      throw refuse(`${path} is not a file under ${MAX_REPORT_BYTES / 1024} KB.`)
    }
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof OrchestrationError) {
      throw error
    }
    throw refuse(`Cannot read the review report at ${path}.`)
  }
}

/**
 * Called before a review task's worker_done commits. The verdict rides in a report file so the
 * existing worker_done identity checks — only the dispatched pane can settle — also guard it.
 */
export async function recordFactoryReviewFromWorkerDone(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  params: { dispatchId: string; taskId: string; outcome: unknown; reportPath: unknown }
): Promise<boolean> {
  const review = db.getFactoryReviewByTask(params.taskId)
  if (!review) {
    return false
  }
  if (params.outcome !== 'succeeded' || review.verdict !== 'pending') {
    return true
  }
  if (typeof params.reportPath !== 'string' || !params.reportPath.trim()) {
    throw refuse('This is a factory review task, so worker_done needs --report-path.')
  }
  let path = params.reportPath.trim()
  if (!isAbsolute(path)) {
    const worktreeId = db.getWorkerDispatch(params.dispatchId)?.worktree_id
    const target = worktreeId ? await host.resolveFactoryWorktreeTarget(`id:${worktreeId}`) : null
    if (!target) {
      throw refuse('Pass an absolute --report-path; this dispatch has no worktree to resolve it.')
    }
    path = join(target.worktree.path, path)
  }
  const report = parseFactoryReviewReport(await readReport(path))
  db.submitFactoryReview({
    reviewId: review.id,
    verdict: report.verdict,
    summary: report.summary,
    findings: JSON.stringify(report.findings)
  })
  return true
}
