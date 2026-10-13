import { describe, expect, it } from 'vitest'
import { formatFactoryAwaitBrief, formatFactoryBriefSaved } from './factory-run-format'

describe('factory brief formatting', () => {
  it('prints the approved agent brief as the thing to build', () => {
    const text = formatFactoryAwaitBrief({
      status: 'approved',
      version: 2,
      agent: 'Show a heart on each doctor and keep the list on this phone.'
    })
    expect(text).toContain('Show a heart on each doctor and keep the list on this phone.')
    expect(text.startsWith('APPROVED.')).toBe(true)
  })

  it('prints a change request and a saved draft', () => {
    expect(
      formatFactoryAwaitBrief({
        status: 'changes_requested',
        version: 1,
        feedback: 'Keep the list on this phone.'
      })
    ).toContain('Keep the list on this phone.')
    expect(formatFactoryBriefSaved({ requestId: 'freq_abc', version: 2 })).toContain(
      'await-brief --request freq_abc'
    )
  })
})
