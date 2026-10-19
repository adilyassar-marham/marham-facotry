import { describe, expect, it } from 'vitest'
import { parseFactoryReviewReport } from './factory-review-report'
import { findExperimentViolations } from './factory-experiment-rules'
import { findBlockedPaths } from './factory-review-spec'
import { workerEvidenceProblem } from './factory-worker-evidence'

describe('factory review report', () => {
  it('accepts a clean pass and a fail with findings', () => {
    expect(parseFactoryReviewReport('{"verdict":"pass","summary":"ok","findings":[]}')).toEqual({
      verdict: 'pass',
      summary: 'ok',
      findings: [],
      axes: null
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

describe('factory review axes', () => {
  const pass = {
    verdict: 'pass',
    standards: [],
    spec: [{ criterion: 'exports api', status: 'met', evidence: 'node -e "ok" → ok' }],
    smells: [{ name: 'Feature envy', file: 'api.ts', note: 'could be local' }],
    blastRadius: []
  }

  it('keeps smells out of the fix list and fails a missing criterion', () => {
    const parsed = parseFactoryReviewReport(JSON.stringify(pass))
    expect(parsed.verdict).toBe('pass')
    expect(parsed.findings).toEqual([])
    expect(parsed.axes?.smells).toEqual([
      { name: 'Feature envy', file: 'api.ts', note: 'could be local' }
    ])
    expect(() =>
      parseFactoryReviewReport(
        JSON.stringify({
          ...pass,
          spec: [{ criterion: 'exports api', status: 'missing', evidence: '' }]
        })
      )
    ).toThrow(/pass/)
    const failed = parseFactoryReviewReport(
      JSON.stringify({
        ...pass,
        verdict: 'fail',
        spec: [{ criterion: 'exports api', status: 'wrong', evidence: 'returned 0' }]
      })
    )
    expect(failed.findings[0]).toMatchObject({ rule: 'Spec', problem: 'exports api is wrong.' })
  })

  it('fails an unproven blast-radius item and ignores a smell-only fail', () => {
    expect(() =>
      parseFactoryReviewReport(
        JSON.stringify({
          verdict: 'pass',
          blastRadius: [{ risk: 'charges the wrong patient', proof: 'It compiles' }]
        })
      )
    ).toThrow(/pass/)
    const failed = parseFactoryReviewReport(
      JSON.stringify({
        verdict: 'fail',
        standards: [
          { rule: '1. Minimal code', file: 'api.ts', line: 4, fix: 'drop it', blocking: true }
        ]
      })
    )
    expect(failed.findings).toEqual([
      {
        rule: '1. Minimal code',
        file: 'api.ts',
        line: 4,
        problem: '1. Minimal code: drop it',
        fix: 'drop it'
      }
    ])
    expect(() =>
      parseFactoryReviewReport(
        JSON.stringify({
          verdict: 'fail',
          smells: [{ name: 'Feature envy', note: 'maybe' }]
        })
      )
    ).toThrow(/Smells do not fail/)
  })
})

describe('worker evidence', () => {
  it('requires a real Evidence section and rejects the compile cop-out', () => {
    expect(workerEvidenceProblem('## Done\nall good')).toMatch(/## Evidence/)
    expect(workerEvidenceProblem('## Evidence\nIt compiles.')).toMatch(/not evidence/)
    expect(
      workerEvidenceProblem('## Evidence\n- Gate: echo ok → ok\n## Pre-existing dead code\nnone')
    ).toBeNull()
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

  it('blocks an experiment that edits the live screen or the tab folder', () => {
    expect(
      findExperimentViolations([
        'src/app/(tabs)/search.jsx',
        'src/app/experiments/search.jsx',
        'src/app/loading.jsx',
        'src/services/remote-config.js'
      ]).map((hit) => hit.file)
    ).toEqual(['src/app/(tabs)/search.jsx'])
    expect(
      findExperimentViolations(['src/app/(tabs)/experiments/search.jsx']).map((hit) => hit.file)
    ).toEqual(['src/app/(tabs)/experiments/search.jsx'])
  })

  it('allows a normal screen fix and a copy-only experiment', () => {
    expect(findExperimentViolations(['src/app/(tabs)/search.jsx'])).toEqual([])
    expect(
      findExperimentViolations([
        'src/app/experiments/search.jsx',
        'src/app/loading.jsx',
        'src/services/remote-config.js'
      ])
    ).toEqual([])
  })
})
