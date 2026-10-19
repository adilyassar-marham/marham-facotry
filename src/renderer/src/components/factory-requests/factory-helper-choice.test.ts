import { describe, expect, it } from 'vitest'
import {
  factoryAutomaticHelper,
  factoryHelperIsIntegrated,
  factoryHelperLabel,
  factoryPreferredHelper
} from './factory-helper-choice'

const none = { claude: false, codex: false }

describe('factory helper choice', () => {
  it('keeps the helper they picked first, even when another one is signed in', () => {
    expect(factoryPreferredHelper('claude', ['cursor', 'claude', 'codex'])).toBe('claude')
    expect(factoryPreferredHelper('blank', ['cursor', 'claude'])).toBe('cursor')
    expect(factoryPreferredHelper('gemini', ['cursor'])).toBe('cursor')
    expect(factoryPreferredHelper(null, [])).toBeNull()
  })

  it('uses a Claude or ChatGPT login already on this computer', () => {
    expect(factoryAutomaticHelper('claude', ['claude', 'codex', 'cursor'], ['codex'], none)).toBe(
      'codex'
    )
    expect(factoryAutomaticHelper('claude', ['claude', 'codex'], ['claude', 'codex'], none)).toBe(
      'claude'
    )
    expect(factoryAutomaticHelper('codex', ['claude', 'codex'], ['claude', 'codex'], none)).toBe(
      'codex'
    )
    expect(factoryAutomaticHelper(null, ['cursor'], ['cursor'], none)).toBe('cursor')
    expect(factoryAutomaticHelper('claude', ['claude', 'codex'], [], none)).toBe('claude')
    expect(factoryHelperLabel('codex')).toBe('ChatGPT')
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
