// TODO(K6): orca factory learn should draft a proposal from factory PR comments. Not built.

export const FACTORY_EVAL_DIFF_JUMP = 1.5

export const FACTORY_EVAL_BENCHMARKS = [
  {
    id: 'doctor-card-discount',
    title: 'Show the discount percentage on the doctor card'
  },
  {
    id: 'wallet-transactions',
    title: 'Make the Wallet Transactions screen easier to use'
  },
  {
    id: 'save-doctors',
    title: 'Let patients save doctors'
  },
  {
    id: 'jazzcash',
    title: 'Let patients pay with JazzCash'
  },
  {
    id: 'empty-state',
    title: 'Fix the broken empty state'
  }
] as const

export type FactoryEvalBenchmarkId = (typeof FACTORY_EVAL_BENCHMARKS)[number]['id']

export type FactoryEvalObservation = {
  benchmark: FactoryEvalBenchmarkId
  pack: boolean
  firstTryGate: boolean
  reviewRounds: number
  blockingFindings: number
  diffLines: number
  filesTouched: number
  realEvidence: boolean
  specMet: number
  specTotal: number
  durationMs: number
  cost: number
}

export type FactoryEvalReport = {
  rows: {
    id: FactoryEvalBenchmarkId
    title: string
    withPack: FactoryEvalObservation
    withoutPack: FactoryEvalObservation
  }[]
  beatsBaseline: boolean
  reason: string
}

function benchmarkId(value: string): FactoryEvalBenchmarkId | null {
  for (const item of FACTORY_EVAL_BENCHMARKS) {
    if (item.id === value) {
      return item.id
    }
  }
  return null
}

function refuse(message: string): Error {
  return new Error(message)
}

function asObject(raw: unknown, label: string): object {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw refuse(`${label} is not an object.`)
  }
  return raw
}

function field(raw: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(raw, key)?.value
}

function boolField(raw: object, key: string, label: string): boolean {
  const value = field(raw, key)
  if (typeof value !== 'boolean') {
    throw refuse(`${label} "${key}" must be true or false.`)
  }
  return value
}

function intField(raw: object, key: string, label: string): number {
  const value = field(raw, key)
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw refuse(`${label} "${key}" must be a non-negative integer.`)
  }
  return value
}

function observationAt(raw: unknown, index: number): FactoryEvalObservation {
  const item = asObject(raw, `runs[${index}]`)
  const named = field(item, 'benchmark')
  const benchmark = typeof named === 'string' ? benchmarkId(named) : null
  if (!benchmark) {
    throw refuse(`runs[${index}] names an unknown benchmark.`)
  }
  const label = `runs[${index}]`
  const specMet = intField(item, 'specMet', label)
  const specTotal = intField(item, 'specTotal', label)
  if (specMet > specTotal) {
    throw refuse(`${label} has more criteria met than it has criteria.`)
  }
  const cost = field(item, 'cost')
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
    throw refuse(`${label} "cost" must be a non-negative number.`)
  }
  return {
    benchmark,
    pack: boolField(item, 'pack', label),
    firstTryGate: boolField(item, 'firstTryGate', label),
    reviewRounds: intField(item, 'reviewRounds', label),
    blockingFindings: intField(item, 'blockingFindings', label),
    diffLines: intField(item, 'diffLines', label),
    filesTouched: intField(item, 'filesTouched', label),
    realEvidence: boolField(item, 'realEvidence', label),
    specMet,
    specTotal,
    durationMs: intField(item, 'durationMs', label),
    cost
  }
}

/** Recorded arms only. This does not launch an agent or read the network. */
export function parseFactoryEvalObservations(raw: string): FactoryEvalObservation[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw refuse('The eval file is not valid JSON.')
  }
  const body = asObject(parsed, 'The eval file')
  const runs = field(body, 'runs')
  if (!Array.isArray(runs)) {
    throw refuse('The eval file needs a "runs" array.')
  }
  return runs.map(observationAt)
}

function rate(met: number, total: number): number {
  return total === 0 ? 0 : met / total
}

function summarize(rows: FactoryEvalReport['rows']): { beatsBaseline: boolean; reason: string } {
  let packFirst = 0
  let baseFirst = 0
  let packMet = 0
  let packTotal = 0
  let baseMet = 0
  let baseTotal = 0
  let packDiff = 0
  let baseDiff = 0
  for (const row of rows) {
    packFirst += row.withPack.firstTryGate ? 1 : 0
    baseFirst += row.withoutPack.firstTryGate ? 1 : 0
    packMet += row.withPack.specMet
    packTotal += row.withPack.specTotal
    baseMet += row.withoutPack.specMet
    baseTotal += row.withoutPack.specTotal
    packDiff += row.withPack.diffLines
    baseDiff += row.withoutPack.diffLines
  }
  const specOk = rate(packMet, packTotal) >= rate(baseMet, baseTotal)
  const firstOk = packFirst >= baseFirst
  const improved = rate(packMet, packTotal) > rate(baseMet, baseTotal) || packFirst > baseFirst
  const diffOk = baseDiff === 0 ? packDiff === 0 : packDiff <= baseDiff * FACTORY_EVAL_DIFF_JUMP
  if (specOk && firstOk && improved && diffOk) {
    return {
      beatsBaseline: true,
      reason:
        'The pack beats the baseline on spec criteria met and first-try gate pass, without a big jump in diff size.'
    }
  }
  const gaps = [
    !firstOk ? 'first-try gate pass is worse' : '',
    !specOk ? 'spec criteria met are worse' : '',
    !improved ? 'neither spec criteria nor first-try gate pass improved' : '',
    !diffOk ? `diff size is more than ${FACTORY_EVAL_DIFF_JUMP}× the baseline` : ''
  ].filter((gap) => gap.length > 0)
  return {
    beatsBaseline: false,
    reason: `The pack does not beat the baseline: ${gaps.join('; ')}.`
  }
}

/** Pairs the five benchmarks. A missing arm does not make the pack the default. */
export function buildFactoryEvalReport(observations: FactoryEvalObservation[]): FactoryEvalReport {
  const seen = new Set<string>()
  const rows: FactoryEvalReport['rows'] = []
  const missing: string[] = []
  for (const benchmark of FACTORY_EVAL_BENCHMARKS) {
    const withPack = observations.find((row) => row.benchmark === benchmark.id && row.pack)
    const withoutPack = observations.find((row) => row.benchmark === benchmark.id && !row.pack)
    const key = (pack: boolean): string => `${benchmark.id}:${pack}`
    for (const row of observations.filter((item) => item.benchmark === benchmark.id)) {
      const id = key(row.pack)
      if (seen.has(id)) {
        throw refuse(
          `Benchmark ${benchmark.id} has two ${row.pack ? 'with-pack' : 'without-pack'} runs.`
        )
      }
      seen.add(id)
    }
    if (!withPack || !withoutPack) {
      missing.push(benchmark.id)
      continue
    }
    rows.push({ id: benchmark.id, title: benchmark.title, withPack, withoutPack })
  }
  if (missing.length > 0) {
    return {
      rows,
      beatsBaseline: false,
      reason: `Incomplete: missing with-pack and without-pack runs for ${missing.join(', ')}.`
    }
  }
  return { rows, ...summarize(rows) }
}

const cell = (pack: string, base: string): string => `${pack} / ${base}`
const yesNo = (value: boolean): string => (value ? 'yes' : 'no')
const seconds = (ms: number): string => String(Math.round(ms / 1000))

/** Cells are with pack / without pack. */
export function renderFactoryEvalReport(report: FactoryEvalReport): string {
  const lines = [
    '## Factory eval report',
    '',
    'Each cell is with the skill pack / without it. This command did not launch an agent.',
    '',
    '| Benchmark | First-try gate | Spec met | Diff lines | Files | Blocking findings | Review rounds | Real evidence | Time (s) | Cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ]
  for (const row of report.rows) {
    const pack = row.withPack
    const base = row.withoutPack
    lines.push(
      `| ${row.id} | ${cell(yesNo(pack.firstTryGate), yesNo(base.firstTryGate))} | ` +
        `${cell(`${pack.specMet}/${pack.specTotal}`, `${base.specMet}/${base.specTotal}`)} | ` +
        `${cell(String(pack.diffLines), String(base.diffLines))} | ` +
        `${cell(String(pack.filesTouched), String(base.filesTouched))} | ` +
        `${cell(String(pack.blockingFindings), String(base.blockingFindings))} | ` +
        `${cell(String(pack.reviewRounds), String(base.reviewRounds))} | ` +
        `${cell(yesNo(pack.realEvidence), yesNo(base.realEvidence))} | ` +
        `${cell(seconds(pack.durationMs), seconds(base.durationMs))} | ` +
        `${cell(String(pack.cost), String(base.cost))} |`
    )
  }
  lines.push('', report.reason)
  return lines.join('\n')
}
