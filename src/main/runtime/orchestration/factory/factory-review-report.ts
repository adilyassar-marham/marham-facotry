import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import type { FactoryVerifyHost } from './factory-verify'
import {
  FACTORY_REVIEW_REPORT_SHAPE,
  parseFactoryReviewDocument,
  type ParsedFactoryReview
} from './factory-review-verdict'

const MAX_REPORT_BYTES = 256 * 1024

export { FACTORY_REVIEW_REPORT_SHAPE }

function refuse(message: string): OrchestrationError {
  return new OrchestrationError(
    'factory_review_report_invalid',
    `${message}\nWrite the review as JSON shaped like ${FACTORY_REVIEW_REPORT_SHAPE}, then send ` +
      'worker_done --outcome succeeded --report-path <that file> again.'
  )
}

export function parseFactoryReviewReport(raw: string): ParsedFactoryReview {
  return parseFactoryReviewDocument(raw)
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
  const submitted = db.submitFactoryReview({
    reviewId: review.id,
    verdict: report.verdict,
    summary: report.summary,
    findings: JSON.stringify(report.findings)
  })
  if (submitted && report.axes) {
    db.recordFactoryReviewDetails({
      review_id: review.id,
      standards_json: JSON.stringify(report.axes.standards),
      spec_json: JSON.stringify(report.axes.spec),
      smells_json: JSON.stringify(report.axes.smells),
      blast_json: JSON.stringify(report.axes.blastRadius)
    })
  }
  return true
}
