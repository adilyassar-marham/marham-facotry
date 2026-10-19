import { describe, expect, it } from 'vitest'
import { parseFactoryReviewReport } from './factory-review-report'
import { findBlockedPaths } from './factory-review-spec'

describe('factory review report', () => {
  it('accepts a clean pass and a fail with findings', () => {
    expect(parseFactoryReviewReport('{"verdict":"pass","summary":"ok","findings":[]}')).toEqual({
      verdict: 'pass',
      summary: 'ok',
      findings: []
    })
    expect(
      parseFactoryReviewReport(
        JSON.stringify({
          verdict: 'fail',
          summary: 'x',
          findings: [{ rule: 'r', problem: 'p', file: 'a.ts', line: 3, fix: 'f', extra: 1 }]
        })
      ).findings
    ).toEqual([{ rule: 'r', problem: 'p', file: 'a.ts', line: 3, fix: 'f' }])
  })

  it.each([
    ['not json', /not valid JSON/],
    ['{"verdict":"maybe","summary":"s"}', /"pass" or "fail"/],
    ['{"verdict":"pass"}', /summary/],
    ['{"verdict":"fail","summary":"s","findings":[]}', /at least one finding/],
    ['{"verdict":"pass","summary":"s","findings":[{"rule":"r","problem":"p"}]}', /means "fail"/],
    ['{"verdict":"fail","summary":"s","findings":[{"rule":"r"}]}', /"rule" and "problem"/]
  ])('rejects %s', (raw, message) => {
    expect(() => parseFactoryReviewReport(raw)).toThrow(message)
  })
})

describe('factory blocked paths', () => {
  it('flags secrets, gate config, and guideline edits but not look-alikes', () => {
    const files = [
      '.env',
      'app/.env.production',
      '.env.example',
      'android/app/release.jks',
      'credentials.json',
      'orca.yaml',
      '.cursor/rules/code.mdc',
      'src/env.ts',
      'src/keyboard.ts'
    ]
    expect(findBlockedPaths(files, ['.cursor/rules/code.mdc']).map((hit) => hit.file)).toEqual([
      '.env',
      'app/.env.production',
      'android/app/release.jks',
      'credentials.json',
      'orca.yaml',
      '.cursor/rules/code.mdc'
    ])
  })

  it('fails a run that edits the skills judging it', () => {
    expect(
      findBlockedPaths(
        [
          '.agents/skills/sharpen/SKILL.md',
          '.agents/skills-overlays/sharpen.md',
          'src/app/fee.tsx'
        ],
        [],
        ['.agents/skills', '.agents/skills-overlays']
      ).map((hit) => hit.file)
    ).toEqual(['.agents/skills/sharpen/SKILL.md', '.agents/skills-overlays/sharpen.md'])
  })
})
