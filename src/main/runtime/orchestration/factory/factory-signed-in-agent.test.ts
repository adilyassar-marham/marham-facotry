import { describe, expect, it } from 'vitest'
import {
  chooseFactorySignedInAgent,
  codexAuthFileIsSignedIn
} from '../../../../shared/factory-signed-in-agent'

describe('factory signed-in agent', () => {
  it('keeps the requested helper when that login is already on the computer', () => {
    expect(chooseFactorySignedInAgent('claude', new Set(['claude', 'cursor']))).toBe('claude')
  })

  it('switches to a signed-in helper when the requested one is not', () => {
    expect(chooseFactorySignedInAgent('claude', new Set(['cursor', 'codex']))).toBe('cursor')
    expect(chooseFactorySignedInAgent('cursor', new Set(['codex']))).toBe('codex')
  })

  it('leaves an unknown helper alone', () => {
    expect(chooseFactorySignedInAgent('gemini', new Set(['cursor']))).toBe('gemini')
  })

  it('returns nothing when none of the known helpers are signed in', () => {
    expect(chooseFactorySignedInAgent('claude', new Set())).toBeNull()
  })

  it('treats a Codex auth file as signed in only when it has a token', () => {
    expect(codexAuthFileIsSignedIn('{"OPENAI_API_KEY":"sk-test"}')).toBe(true)
    expect(codexAuthFileIsSignedIn('{"tokens":{"access_token":"tok"}}')).toBe(true)
    expect(codexAuthFileIsSignedIn('{"tokens":{}}')).toBe(false)
    expect(codexAuthFileIsSignedIn('not json')).toBe(false)
  })
})
