import {
  FACTORY_SUPERSEDED_TASK_RESULT,
  type FactoryRequestQuestion,
  type FactoryRequestStage,
  type FactoryRequestView
} from '../../../../shared/factory-request-types'
import type { FactoryRunReport } from '../../../../shared/factory-run-types'
import type { OrchestrationDb } from '../db'
import type { FactoryQuestionRow, FactoryRequestRow } from '../db/factory/factory-row-types'
import type { TaskRow } from '../types'
import { buildFactoryRunReport } from './factory-run-report'

const toQuestion = (row: FactoryQuestionRow): FactoryRequestQuestion => ({
  id: row.id,
  question: row.question,
  answer: row.answer,
  askedAt: row.asked_at
})

function needsEngineer(report: FactoryRunReport, buildTasks: TaskRow[]): boolean {
  if (report.fixRoundsUsed > report.maxFixRounds) {
    return true
  }
  if (report.baseline?.status === 'not_approved' || report.integration?.status === 'not_approved') {
    return true
  }
  const open = buildTasks.some((task) => task.status !== 'completed' && task.status !== 'failed')
  return !open && buildTasks.some((task) => task.status === 'failed')
}

function deriveStage(
  db: OrchestrationDb,
  request: FactoryRequestRow,
  report: FactoryRunReport | null,
  buildTasks: TaskRow[],
  pendingQuestion: boolean
): FactoryRequestStage {
  if (request.cancelled) {
    return 'cancelled'
  }
  if (!request.run_id || !report) {
    return 'starting'
  }
  if (report.pullRequest) {
    return 'pr_opened'
  }
  if (report.prReadiness.ready) {
    return 'ready_for_pr'
  }
  if (needsEngineer(report, buildTasks)) {
    return 'needs_engineer'
  }
  if (pendingQuestion) {
    return 'question'
  }
  const approval = db.getFactoryPlanApproval(request.run_id)
  if (approval?.status === 'awaiting') {
    return 'plan_approval'
  }
  if (!report.baseline) {
    return 'setting_up'
  }
  if (
    approval?.status === 'changes_requested' ||
    (approval?.status === 'approved' && approval.feedback) ||
    buildTasks.length === 0
  ) {
    return 'planning'
  }
  const landed = new Set(db.listFactoryLandings(request.run_id).map((row) => row.task_id))
  return buildTasks.every((task) => landed.has(task.id)) ? 'reviewing' : 'building'
}

export function buildFactoryRequestView(
  db: OrchestrationDb,
  request: FactoryRequestRow
): FactoryRequestView {
  const runId = request.run_id
  const report = runId ? buildFactoryRunReport(db, runId) : null
  const reviewTasks = new Set(
    runId ? db.listFactoryReviews(runId).map((review) => review.task_id) : []
  )
  const buildTasks = runId
    ? db
        .listTasks({ runId })
        .filter(
          (task) => !reviewTasks.has(task.id) && task.result !== FACTORY_SUPERSEDED_TASK_RESULT
        )
    : []
  const questions = runId ? db.listFactoryQuestions(runId).map(toQuestion) : []
  const pendingQuestion = questions.find((question) => question.answer === null) ?? null
  const approval = runId ? db.getFactoryPlanApproval(runId) : undefined
  const landed = new Set(runId ? db.listFactoryLandings(runId).map((row) => row.task_id) : [])
  const stage = deriveStage(db, request, report, buildTasks, pendingQuestion !== null)
  return {
    id: request.id,
    repoId: request.repo_id,
    title: request.title,
    description: request.description,
    agent: request.agent,
    createdAt: request.created_at,
    cancelled: request.cancelled === 1,
    worktreeId: request.worktree_id,
    runId,
    stage,
    progress:
      stage === 'building'
        ? {
            done: buildTasks.filter((task) => landed.has(task.id)).length,
            total: buildTasks.length
          }
        : null,
    pendingQuestion,
    answeredQuestions: questions.filter((question) => question.answer !== null),
    planApproval: approval?.status ?? null,
    planFeedback: approval?.feedback ?? null,
    plan: buildTasks.map((task) => ({
      taskId: task.id,
      title: task.task_title ?? task.spec.split('\n')[0].slice(0, 120),
      spec: task.spec,
      status: task.status
    })),
    report
  }
}

export function listFactoryRequestViews(db: OrchestrationDb): FactoryRequestView[] {
  return db.listFactoryRequests().map((request) => buildFactoryRequestView(db, request))
}
