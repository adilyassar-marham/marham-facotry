import { describe, expect, it } from 'vitest'
import type { FactoryRequestView } from '../../../../shared/factory-request-types'
import { factoryRequestChat, factoryRequestStatusText } from './factory-request-chat'

const request = (overrides: Partial<FactoryRequestView>): FactoryRequestView => ({
  id: 'freq_1',
  repoId: 'repo_app',
  title: 'Show the discount',
  description: 'Show the discount percentage on the doctor card.',
  agent: 'cursor',
  createdAt: '2026-10-08',
  cancelled: false,
  worktreeId: null,
  runId: 'run_1',
  stage: 'planning',
  progress: null,
  pendingQuestion: null,
  answeredQuestions: [],
  planApproval: null,
  planFeedback: null,
  plan: [],
  report: null,
  ...overrides
})

describe('factory request chat', () => {
  it('reads as a conversation: your words, a question, your answer, then the plan', () => {
    const turns = factoryRequestChat(
      request({
        stage: 'plan_approval',
        planApproval: 'awaiting',
        answeredQuestions: [
          {
            id: 'fq_1',
            question: 'Should it say 10% off?',
            answer: 'Yes, next to the new fee.',
            askedAt: ''
          }
        ],
        plan: [
          { taskId: 'task_1', title: 'Add the percent-off label', spec: 'long', status: 'ready' }
        ]
      })
    )
    expect(turns.map((turn) => turn.role)).toEqual(['you', 'assistant', 'you', 'assistant'])
    expect(turns[0]?.text).toBe('Show the discount percentage on the doctor card.')
    expect(turns[2]?.text).toBe('Yes, next to the new fee.')
    expect(turns[3]?.text).toContain('Add the percent-off label')
    expect(turns[3]?.text).not.toContain('long')
  })

  it('says when a rules check failed and the work is being fixed', () => {
    const view = request({
      stage: 'reviewing',
      report: {
        repoId: 'repo_app',
        baseBranch: 'master',
        integrationBranch: 'factory/run_1',
        integrationWorktreePath: null,
        maxWorkers: 3,
        maxFixRounds: 3,
        baseline: null,
        integration: null,
        reviews: [
          {
            id: 'rev_1',
            round: 1,
            taskId: null,
            headSha: 'abc',
            verdict: 'fail',
            summary: 'extra check',
            findings: [],
            mechanical: false,
            createdAt: '',
            submittedAt: ''
          }
        ],
        fixRoundsUsed: 1,
        pullRequest: null,
        prReadiness: { ready: false, reasons: [] },
        gateRefusals: 0,
        skills: []
      }
    })
    expect(factoryRequestChat(view).some((turn) => turn.text.includes('wasn’t quite right'))).toBe(
      false
    )
    expect(factoryRequestStatusText(view)).toContain('wasn’t quite right')
  })

  it('says it is still reading when a new message has been waiting', () => {
    const text = factoryRequestStatusText(
      request({ stage: 'intake', runId: null, createdAt: '2026-10-08T00:00:00.000Z' }),
      Date.parse('2026-10-08T00:05:00.000Z')
    )
    expect(text).toBe('Still reading your message. Stop it if you don’t want to keep waiting.')
  })
})
