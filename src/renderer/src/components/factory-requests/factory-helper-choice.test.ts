import { describe, expect, it } from 'vitest'
import { factoryHelperIsIntegrated, factoryPreferredHelper } from './factory-helper-choice'

const none = { claude: false, codex: false }

describe('factory helper choice', () => {
  it('keeps the helper they picked first, even when another one is signed in', () => {
    expect(factoryPreferredHelper('claude', ['cursor', 'claude', 'codex'])).toBe('claude')
    expect(factoryPreferredHelper('blank', ['cursor', 'claude'])).toBe('cursor')
    expect(factoryPreferredHelper('gemini', ['cursor'])).toBe('cursor')
    expect(factoryPreferredHelper(null, [])).toBeNull()
  })

  it('counts a system login or an account already added here', () => {
    expect(factoryHelperIsIntegrated('claude', ['cursor'], none)).toBe(false)
    expect(factoryHelperIsIntegrated('claude', ['claude'], none)).toBe(true)
    expect(factoryHelperIsIntegrated('claude', [], { claude: true, codex: false })).toBe(true)
    expect(factoryHelperIsIntegrated('codex', [], { claude: false, codex: true })).toBe(true)
    expect(factoryHelperIsIntegrated('cursor', [], none)).toBe(false)
    expect(factoryHelperIsIntegrated('gemini', [], none)).toBe(true)
  })
})
