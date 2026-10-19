import { afterEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../db'
import { factoryRepoBlocksSkillSync } from './factory-skill-activity'

describe('factory skill sync activity', () => {
  let db: OrchestrationDb | undefined
  afterEach(() => db?.close())

  it('blocks a live run and allows a cancelled request, a pull request, or a passing review', () => {
    db = new OrchestrationDb(':memory:')
    db.upsertFactoryRun({
      runId: 'run_live',
      repoId: 'repo',
      baseBranch: 'main',
      maxWorkers: 1,
      maxFixRounds: 1
    })
    expect(factoryRepoBlocksSkillSync(db, 'repo')).toBe(true)

    const request = db.createFactoryRequest({
      repoId: 'repo',
      title: 'Save a doctor',
      description: 'Let a person save a doctor they want to see again.',
      agent: 'cursor'
    })
    db.linkFactoryRequestRun(request.id, 'run_live')
    db.cancelFactoryRequest(request.id)
    expect(factoryRepoBlocksSkillSync(db, 'repo')).toBe(false)

    db.upsertFactoryRun({
      runId: 'run_pr',
      repoId: 'repo',
      baseBranch: 'main',
      maxWorkers: 1,
      maxFixRounds: 1
    })
    db.recordFactoryPullRequest({
      run_id: 'run_pr',
      url: 'https://example.com/pull/1',
      number: 1,
      head_branch: 'factory/run_pr',
      base_branch: 'main',
      head_sha: 'a'.repeat(40)
    })
    expect(factoryRepoBlocksSkillSync(db, 'repo')).toBe(false)

    db.upsertFactoryRun({
      runId: 'run_review',
      repoId: 'repo',
      baseBranch: 'main',
      maxWorkers: 1,
      maxFixRounds: 1
    })
    const review = db.createFactoryReview({
      runId: 'run_review',
      round: 1,
      taskId: null,
      headSha: 'b'.repeat(40)
    })
    expect(factoryRepoBlocksSkillSync(db, 'repo')).toBe(true)
    db.submitFactoryReview({
      reviewId: review.id,
      verdict: 'pass',
      summary: 'ok',
      findings: '[]'
    })
    expect(factoryRepoBlocksSkillSync(db, 'repo')).toBe(false)
  })
})
