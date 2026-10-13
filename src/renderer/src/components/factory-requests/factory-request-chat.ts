import { translate } from '@/i18n/i18n'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'
export type FactoryChatTurn = {
  id: string
  role: 'you' | 'assistant'
  text: string
}

function statusLine(request: FactoryRequestView): string | null {
  const latest = request.report?.reviews.at(-1)
  if (request.stage === 'reviewing' && latest?.verdict === 'fail') {
    return translate(
      'auto.components.factoryRequests.chat.fixing',
      'That version didn’t match our rules. I’m fixing it, then I’ll check again.'
    )
  }
  switch (request.stage) {
    case 'intake':
      return translate(
        'auto.components.factoryRequests.chat.intake',
        'I’m making sure I understand this before I build anything.'
      )
    case 'awaiting_brief_approval':
      return translate(
        'auto.components.factoryRequests.chat.briefApproval',
        'I wrote up what I’ll build. Tell me if it looks right.'
      )
    case 'starting':
    case 'setting_up':
      return translate(
        'auto.components.factoryRequests.chat.starting',
        'I’m getting the project ready. I’ll ask if anything is unclear.'
      )
    case 'planning':
      return translate(
        'auto.components.factoryRequests.chat.planning',
        'I’m writing a short plan for you to look over.'
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
      return translate(
        'auto.components.factoryRequests.chat.reviewing',
        'I’m checking the work against our coding rules.'
      )
    case 'ready_for_pr':
      return translate(
        'auto.components.factoryRequests.chat.ready',
        'This matches our rules. Send it to the engineers when you want them to look.'
      )
    case 'pr_opened':
      return translate('auto.components.factoryRequests.chat.sent', 'It’s with the engineers now.')
    case 'needs_engineer':
      return translate(
        'auto.components.factoryRequests.chat.needsEngineer',
        'I couldn’t finish this within our rules. An engineer needs to take a look.'
      )
    case 'cancelled':
      return translate('auto.components.factoryRequests.chat.cancelled', 'This was cancelled.')
    case 'question':
    case 'plan_approval':
      return null
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
  for (const question of request.answeredQuestions) {
    turns.push({ id: question.id, role: 'assistant', text: question.question })
    if (question.answer) {
      turns.push({ id: `${question.id}-answer`, role: 'you', text: question.answer })
    }
  }
  if (request.pendingQuestion) {
    turns.push({
      id: request.pendingQuestion.id,
      role: 'assistant',
      text: request.pendingQuestion.question
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
        'Got it. I’ll update the plan and start building.'
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
        'Got it. I’ll update the plan.'
      )
    })
  }
  const status =
    request.planApproval === 'approved' && request.planFeedback ? null : statusLine(request)
  if (status) {
    turns.push({ id: `status-${request.stage}`, role: 'assistant', text: status })
  }
  return turns
}
