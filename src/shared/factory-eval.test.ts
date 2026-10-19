import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FACTORY_EVAL_BENCHMARKS,
  type FactoryEvalObservation,
  buildFactoryEvalReport,
  parseFactoryEvalObservations,
  renderFactoryEvalReport
} from './factory-eval'

function arm(
  benchmark: FactoryEvalObservation['benchmark'],
  pack: boolean,
  overrides: Partial<FactoryEvalObservation> = {}
): FactoryEvalObservation {
  return {
    benchmark,
    pack,
    firstTryGate: pack,
    reviewRounds: pack ? 1 : 2,
    blockingFindings: pack ? 0 : 1,
    diffLines: 40,
    filesTouched: 2,
    realEvidence: pack,
    specMet: pack ? 2 : 1,
    specTotal: 2,
    durationMs: 1000,
    cost: 0.2,
    ...overrides
  }
}

function bothArms(
  overrides: (pack: boolean) => Partial<FactoryEvalObservation> = () => ({})
): FactoryEvalObservation[] {
  return FACTORY_EVAL_BENCHMARKS.flatMap((benchmark) => [
    arm(benchmark.id, true, overrides(true)),
    arm(benchmark.id, false, overrides(false))
  ])
}

describe('factory eval', () => {
  it('keeps the five benchmark requests on disk', () => {
    for (const benchmark of FACTORY_EVAL_BENCHMARKS) {
      const text = readFileSync(
        join(process.cwd(), 'docs/factory/evals', `${benchmark.id}.md`),
        'utf8'
      )
      expect(text).toContain(`# ${benchmark.id}`)
      expect(text).toContain(benchmark.title)
    }
  })

  it('builds a with-pack and without-pack table and recommends the pack only when it wins', () => {
    const report = buildFactoryEvalReport(bothArms())
    expect(report.beatsBaseline).toBe(true)
    expect(report.rows).toHaveLength(5)
    const table = renderFactoryEvalReport(report)
    expect(table).toContain('## Factory eval report')
    expect(table).toContain('doctor-card-discount')
    expect(table).toContain('yes / no')
    expect(table).toContain('2/2 / 1/2')
    expect(table).toContain('did not launch an agent')

    const jumped = buildFactoryEvalReport(bothArms((pack) => ({ diffLines: pack ? 90 : 40 })))
    expect(jumped.beatsBaseline).toBe(false)
    expect(jumped.reason).toMatch(/1\.5×/)

    const tied = buildFactoryEvalReport(bothArms(() => ({ firstTryGate: true, specMet: 2 })))
    expect(tied.beatsBaseline).toBe(false)
    expect(tied.reason).toMatch(/does not beat/)
  })

  it('refuses a missing arm, a duplicate, and an unknown benchmark', () => {
    const rows = bothArms().filter((row) => row.benchmark !== 'jazzcash' || row.pack)
    expect(buildFactoryEvalReport(rows).reason).toMatch(/jazzcash/)
    expect(buildFactoryEvalReport(rows).beatsBaseline).toBe(false)
    expect(() => buildFactoryEvalReport([...bothArms(), arm('empty-state', true)])).toThrow(
      /two with-pack/
    )
    expect(() => parseFactoryEvalObservations('{"runs":[{"benchmark":"other"}]}')).toThrow(
      /unknown benchmark/
    )
  })
})
