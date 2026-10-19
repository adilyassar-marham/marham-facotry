import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'
import type { FactoryVerifyHost } from './factory-verify'

const MAX_REPORT_BYTES = 256 * 1024
const COP_OUT = /^(it compiles|should work)[.!]?$/i

/** Null when the report has a real Evidence section. The cop-out phrases are not evidence. */
export function workerEvidenceProblem(markdown: string): string | null {
  const match = /^## Evidence[^\n]*$/m.exec(markdown)
  if (!match || match.index === undefined) {
    return 'The worker report needs a "## Evidence" section: the command you ran and what it printed.'
  }
  const rest = markdown.slice(match.index + match[0].length)
  const next = /^## /m.exec(rest)
  const body = (next ? rest.slice(0, next.index) : rest).trim()
  if (!body || COP_OUT.test(body)) {
    return '"It compiles" is not evidence. Record the command and what it printed for each acceptance criterion.'
  }
  return null
}

async function readReport(path: string): Promise<string> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_REPORT_BYTES) {
      throw new Error('unreadable')
    }
    return await readFile(path, 'utf8')
  } catch {
    throw new OrchestrationError(
      'factory_evidence_missing',
      `Cannot read the worker report at ${path}. A skill-pack run needs --report-path with a "## Evidence" section.`
    )
  }
}

/**
 * A run that snapshotted skills cannot finish a build task on "it compiles".
 * Review tasks are excluded by the caller.
 */
export async function enforceWorkerEvidence(
  db: OrchestrationDb,
  host: FactoryVerifyHost,
  params: { taskId: string; dispatchId: string; reportPath: unknown }
): Promise<void> {
  const runId = db.getTask(params.taskId)?.run_id
  if (!runId || !db.getFactoryRunSkillPack(runId)) {
    return
  }
  if (typeof params.reportPath !== 'string' || !params.reportPath.trim()) {
    throw new OrchestrationError(
      'factory_evidence_missing',
      'This run uses a skill pack, so worker_done needs --report-path pointing at a report with a "## Evidence" section.'
    )
  }
  let path = params.reportPath.trim()
  if (!isAbsolute(path)) {
    const worktreeId = db.getWorkerDispatch(params.dispatchId)?.worktree_id
    const target = worktreeId ? await host.resolveFactoryWorktreeTarget(`id:${worktreeId}`) : null
    if (!target) {
      throw new OrchestrationError(
        'factory_evidence_missing',
        'Pass an absolute --report-path; this dispatch has no worktree to resolve it.'
      )
    }
    path = join(target.worktree.path, path)
  }
  const problem = workerEvidenceProblem(await readReport(path))
  if (problem) {
    throw new OrchestrationError('factory_evidence_missing', problem)
  }
}
