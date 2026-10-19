import { translate } from '@/i18n/i18n'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'
import { factoryRequestMinutesSince } from './factory-request-presentation'
export type FactoryChatTurn = {
  id: string
  role: 'you' | 'assistant'
  text: string
  /** The line that is happening now. It changes as the work moves. */
  live?: boolean
}

function waitingStatus(
  request: FactoryRequestView,
  nowMs: number,
  fresh: string,
  stalled: string
): string {
  const minutes = factoryRequestMinutesSince(request.createdAt, nowMs)
  return minutes !== null && minutes >= 2 ? stalled : fresh
}

/** The agent's current reply. Null when it is the person's turn. */
export function factoryRequestWorkingReply(request: FactoryRequestView): string | null {
  const latest = request.report?.reviews.at(-1)
  switch (request.stage) {
    case 'intake':
      return translate('auto.components.factoryRequests.chat.workRead', 'Reading it now.')
    case 'starting':
      return translate('auto.components.factoryRequests.chat.workStart', 'Working on it.')
    case 'setting_up':
      return translate(
        'auto.components.factoryRequests.chat.workSetup',
        'Getting the project ready.'
      )
    case 'planning':
      return translate('auto.components.factoryRequests.chat.workPlan', 'Working out the steps.')
    case 'building':
      return request.progress
        ? translate(
            'auto.components.factoryRequests.chat.buildingProgress',
            'I’m building this now. {{value0}} of {{value1}} done.',
            { value0: request.progress.done, value1: request.progress.total }
          )
        : translate('auto.components.factoryRequests.chat.workBuild', 'Building it now.')
    case 'reviewing':
      return latest?.verdict === 'fail'
        ? translate('auto.components.factoryRequests.chat.workFix', 'Fixing it.')
        : translate('auto.components.factoryRequests.chat.workCheck', 'Looking it over.')
    default:
      return null
  }
}

const WORK_STAGES = [
  'intake',
  'starting',
  'setting_up',
  'planning',
  'building',
  'reviewing'
] as const
const WORK_IDS = [
  'work-read',
  'work-start',
  'work-setup',
  'work-plan',
  'work-build',
  'work-check'
] as const

function workStageIndex(stage: FactoryRequestView['stage']): number {
  let found = -1
  WORK_STAGES.forEach((item, index) => {
    if (item === stage) {
      found = index
    }
  })
  return found
}

function workScript(request: FactoryRequestView): FactoryChatTurn[] {
  return WORK_STAGES.map((stage, index) => ({
    id: WORK_IDS[index] ?? stage,
    role: 'assistant',
    text:
      factoryRequestWorkingReply(
        stage === request.stage ? request : { ...request, stage, progress: null, report: null }
      ) ?? ''
  }))
}

/** Where this request is, in one sentence. Shown above the chat, not as a fake reply. */
export function factoryRequestStatusText(request: FactoryRequestView, nowMs = Date.now()): string {
  const latest = request.report?.reviews.at(-1)
  if (request.stage === 'reviewing' && latest?.verdict === 'fail') {
    return translate(
      'auto.components.factoryRequests.chat.fixing',
      'That version wasn’t quite right. I’m fixing it.'
    )
  }
  switch (request.stage) {
    case 'intake':
      return waitingStatus(
        request,
        nowMs,
        translate(
          'auto.components.factoryRequests.chat.intake',
          'I got your message. Reading it now. This can take a minute.'
        ),
        translate(
          'auto.components.factoryRequests.chat.intakeWaiting',
          'Still reading your message. Stop it if you don’t want to keep waiting.'
        )
      )
    case 'awaiting_brief_approval':
      return translate(
        'auto.components.factoryRequests.chat.briefApproval',
        'I wrote up what I’ll build. Tell me if it looks right.'
      )
    case 'starting':
      return waitingStatus(
        request,
        nowMs,
        translate(
          'auto.components.factoryRequests.chat.starting',
          'The helper is starting. This can take a minute.'
        ),
        translate(
          'auto.components.factoryRequests.chat.startingWaiting',
          'Still starting the helper. Stop it if you don’t want to keep waiting.'
        )
      )
    case 'setting_up':
      return translate(
        'auto.components.factoryRequests.chat.settingUp',
        'I’m getting the project ready.'
      )
    case 'planning':
      return translate(
        'auto.components.factoryRequests.chat.planning',
        'I’m working out the steps.'
      )
    case 'building':
      return request.progress
        ? translate(
            'auto.components.factoryRequests.chat.buildingProgress',
            'I’m building this now. {{value0}} of {{value1}} done.',
            { value0: request.progress.done, value1: request.progress.total }
          )
        : translate('auto.components.factoryRequests.chat.building', 'I’m building this now.')
    case 'reviewing':
      return translate('auto.components.factoryRequests.chat.reviewing', 'I’m looking it over.')
    case 'ready_for_pr':
      return translate(
        'auto.components.factoryRequests.chat.ready',
        'It’s ready. Send it when you want.'
      )
    case 'pr_opened':
      return translate('auto.components.factoryRequests.chat.sent', 'It’s sent.')
    case 'needs_engineer':
      return translate(
        'auto.components.factoryRequests.chat.needsEngineer',
        'I need an engineer to look at this.'
      )
    case 'cancelled':
      return translate('auto.components.factoryRequests.chat.cancelled', 'This was cancelled.')
    case 'question':
      return translate('auto.components.factoryRequests.chat.question', 'Your turn. Reply below.')
    case 'plan_approval':
      return translate(
        'auto.components.factoryRequests.chat.planApproval',
        'Your turn. Say if I should build this.'
      )
  }
}

/** The request as a chat: what you said, questions, the plan, and where things stand. */
export function factoryRequestChat(request: FactoryRequestView): FactoryChatTurn[] {
  const turns: FactoryChatTurn[] = [
    { id: 'you', role: 'you', text: request.description.trim() || request.title }
  ]
  for (const message of request.messages ?? []) {
    if (message.kind === 'say') {
      turns.push({ id: message.id, role: 'assistant', text: message.body })
    }
  }
  const seenQuestions = new Set<string>()
  for (const question of request.answeredQuestions) {
    const key = question.question.trim().toLowerCase()
    if (seenQuestions.has(key)) {
      continue
    }
    seenQuestions.add(key)
    turns.push({ id: question.id, role: 'assistant', text: question.question })
    if (question.answer) {
      turns.push({ id: `${question.id}-answer`, role: 'you', text: question.answer })
    }
  }
  const building =
    request.brief?.status === 'approved' &&
    (request.stage === 'starting' || request.stage === 'setting_up' || request.stage === 'building')
  if (request.pendingQuestion && !building) {
    turns.push({
      id: request.pendingQuestion.id,
      role: 'assistant',
      text: request.pendingQuestion.question
    })
  }
  if (building) {
    turns.push({
      id: 'build-it',
      role: 'you',
      text: translate('auto.components.factoryRequests.brief.approve', 'Looks good, build it')
    })
  }
  const workIndex = workStageIndex(request.stage)
  if (workIndex >= 0) {
    const script = workScript(request)
    script.slice(0, workIndex + 1).forEach((line, index) => {
      turns.push({ ...line, live: index === workIndex })
    })
  }
  if (request.plan.length > 0 && request.planApproval === 'awaiting') {
    const lines = request.plan.map((task, index) => `${index + 1}. ${task.title}`).join('\n')
    turns.push({
      id: 'plan',
      role: 'assistant',
      text: translate(
        'auto.components.factoryRequests.chat.plan',
        'Here’s what I’ll do:\n{{value0}}\n\nWant me to build this?',
        { value0: lines }
      )
    })
  }
  if (request.planFeedback && request.planApproval === 'approved') {
    turns.push({ id: 'feedback', role: 'you', text: request.planFeedback })
    turns.push({
      id: 'building-changes',
      role: 'assistant',
      text: translate(
        'auto.components.factoryRequests.chat.buildingChanges',
        'Got it. I’ll include that and start building.'
      )
    })
  }
  if (request.planFeedback && request.planApproval === 'changes_requested') {
    turns.push({ id: 'feedback', role: 'you', text: request.planFeedback })
    turns.push({
      id: 'revising',
      role: 'assistant',
      text: translate(
        'auto.components.factoryRequests.chat.revising',
        'Got it. I’ll redo the steps.'
      )
    })
  }
  return turns
}
