import type { FactoryReviewFinding } from '../../../../shared/factory-run-types'
import { OrchestrationError } from '../orchestration-error'

const MAX_ITEMS = 100
const MAX_TEXT = 2000

export const FACTORY_REVIEW_REPORT_SHAPE =
  '{ "verdict": "pass" | "fail", "summary": "<one paragraph>", ' +
  '"standards": [{ "rule": "<rule>", "file": "<path>", "line": 12, "fix": "<change>", "blocking": true }], ' +
  '"spec": [{ "criterion": "<acceptance line>", "status": "met" | "missing" | "wrong", "evidence": "<how checked>" }], ' +
  '"smells": [{ "name": "<smell>", "file": "<path>", "note": "<advice>" }], ' +
  '"blastRadius": [{ "risk": "<what could break>", "proof": "<command and its result>" }] }'

export type FactoryReviewStandard = {
  rule: string
  file?: string
  line?: number
  fix?: string
  blocking: boolean
}

export type FactoryReviewSpecItem = {
  criterion: string
  status: 'met' | 'missing' | 'wrong'
  evidence: string
}

export type FactoryReviewSmell = {
  name: string
  file?: string
  note: string
}

export type FactoryReviewBlast = {
  risk: string
  proof: string
}

export type FactoryReviewAxes = {
  standards: FactoryReviewStandard[]
  spec: FactoryReviewSpecItem[]
  smells: FactoryReviewSmell[]
  blastRadius: FactoryReviewBlast[]
}

export type ParsedFactoryReview = {
  verdict: 'pass' | 'fail'
  summary: string
  findings: FactoryReviewFinding[]
  axes: FactoryReviewAxes | null
}

const AXIS_KEYS = ['standards', 'spec', 'smells', 'blastRadius'] as const

function refuse(message: string): OrchestrationError {
  return new OrchestrationError(
    'factory_review_report_invalid',
    `${message}\nWrite the review as JSON shaped like ${FACTORY_REVIEW_REPORT_SHAPE}, then send ` +
      'worker_done --outcome succeeded --report-path <that file> again.'
  )
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : ''

function field(raw: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(raw, key)?.value
}

function objectAt(raw: unknown, label: string): object {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw refuse(`${label} is not an object.`)
  }
  return raw
}

function list(raw: unknown, label: string): unknown[] {
  if (raw === undefined) {
    return []
  }
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) {
    throw refuse(`"${label}" must be an array of at most ${MAX_ITEMS} items.`)
  }
  return raw
}

function lineOf(raw: object): number | undefined {
  const line = field(raw, 'line')
  return typeof line === 'number' && Number.isInteger(line) && line > 0 ? line : undefined
}

function standardAt(raw: unknown, index: number): FactoryReviewStandard {
  const item = objectAt(raw, `standards[${index}]`)
  const rule = text(field(item, 'rule'))
  if (!rule) {
    throw refuse(`standards[${index}] needs a "rule".`)
  }
  const file = text(field(item, 'file'))
  const fix = text(field(item, 'fix'))
  const line = lineOf(item)
  return {
    rule,
    blocking: field(item, 'blocking') !== false,
    ...(file ? { file } : {}),
    ...(line ? { line } : {}),
    ...(fix ? { fix } : {})
  }
}

function specAt(raw: unknown, index: number): FactoryReviewSpecItem {
  const item = objectAt(raw, `spec[${index}]`)
  const criterion = text(field(item, 'criterion'))
  const status = field(item, 'status')
  if (!criterion || (status !== 'met' && status !== 'missing' && status !== 'wrong')) {
    throw refuse(`spec[${index}] needs a "criterion" and status "met", "missing", or "wrong".`)
  }
  return { criterion, status, evidence: text(field(item, 'evidence')) }
}

function smellAt(raw: unknown, index: number): FactoryReviewSmell {
  const item = objectAt(raw, `smells[${index}]`)
  const name = text(field(item, 'name'))
  if (!name) {
    throw refuse(`smells[${index}] needs a "name".`)
  }
  const file = text(field(item, 'file'))
  return { name, note: text(field(item, 'note')), ...(file ? { file } : {}) }
}

function blastAt(raw: unknown, index: number): FactoryReviewBlast {
  const item = objectAt(raw, `blastRadius[${index}]`)
  const risk = text(field(item, 'risk'))
  if (!risk) {
    throw refuse(`blastRadius[${index}] needs a "risk".`)
  }
  return { risk, proof: text(field(item, 'proof')) }
}

function proven(proof: string): boolean {
  const value = proof
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/g, '')
  return value.length > 0 && value !== 'it compiles' && value !== 'should work'
}

function blockingFindings(axes: FactoryReviewAxes): FactoryReviewFinding[] {
  const findings: FactoryReviewFinding[] = []
  for (const item of axes.standards) {
    if (!item.blocking) {
      continue
    }
    findings.push({
      rule: item.rule,
      problem: item.fix ? `${item.rule}: ${item.fix}` : item.rule,
      ...(item.file ? { file: item.file } : {}),
      ...(item.line ? { line: item.line } : {}),
      ...(item.fix ? { fix: item.fix } : {})
    })
  }
  for (const item of axes.spec) {
    if (item.status === 'met') {
      continue
    }
    findings.push({
      rule: 'Spec',
      problem: `${item.criterion} is ${item.status}.`,
      fix: item.evidence || 'Meet this acceptance criterion and record how you checked it.'
    })
  }
  for (const item of axes.blastRadius) {
    if (proven(item.proof)) {
      continue
    }
    findings.push({
      rule: 'Blast radius',
      problem: `${item.risk} has no command and result.`,
      fix: 'Run a command that exercises this risk and paste the command and its output.'
    })
  }
  return findings
}

function parseAxes(parsed: object): FactoryReviewAxes {
  return {
    standards: list(field(parsed, 'standards'), 'standards').map(standardAt),
    spec: list(field(parsed, 'spec'), 'spec').map(specAt),
    smells: list(field(parsed, 'smells'), 'smells').map(smellAt),
    blastRadius: list(field(parsed, 'blastRadius'), 'blastRadius').map(blastAt)
  }
}

function legacyFinding(raw: unknown, index: number): FactoryReviewFinding {
  const item = objectAt(raw, `findings[${index}]`)
  const rule = text(field(item, 'rule'))
  const problem = text(field(item, 'problem'))
  if (!rule || !problem) {
    throw refuse(`findings[${index}] needs both "rule" and "problem".`)
  }
  const file = text(field(item, 'file'))
  const fix = text(field(item, 'fix'))
  const line = lineOf(item)
  return {
    rule,
    problem,
    ...(file ? { file } : {}),
    ...(line ? { line } : {}),
    ...(fix ? { fix } : {})
  }
}

function parseLegacy(body: object, verdict: 'pass' | 'fail'): ParsedFactoryReview {
  const summary = text(field(body, 'summary'))
  if (!summary) {
    throw refuse('"summary" is required.')
  }
  const findings = list(field(body, 'findings') ?? [], 'findings').map(legacyFinding)
  if (verdict === 'fail' && findings.length === 0) {
    throw refuse('A "fail" verdict must list at least one finding.')
  }
  if (verdict === 'pass' && findings.length > 0) {
    throw refuse('A "pass" verdict must have an empty findings list; any finding means "fail".')
  }
  return { verdict, summary, findings, axes: null }
}

/** The two-axis report. Legacy `{ summary, findings }` reports return `axes: null`. */
export function parseFactoryReviewDocument(raw: string): ParsedFactoryReview {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw refuse('The review report is not valid JSON.')
  }
  const body = objectAt(parsed, 'The review report')
  const verdict = field(body, 'verdict')
  if (verdict !== 'pass' && verdict !== 'fail') {
    throw refuse('"verdict" must be "pass" or "fail".')
  }
  if (!AXIS_KEYS.some((key) => field(body, key) !== undefined)) {
    return parseLegacy(body, verdict)
  }
  const axes = parseAxes(body)
  const findings = blockingFindings(axes)
  if (verdict === 'pass' && findings.length > 0) {
    throw refuse(
      'A "pass" still has a blocking standards finding, a missing or wrong criterion, or an unproven blast-radius item. Smells do not count.'
    )
  }
  if (verdict === 'fail' && findings.length === 0) {
    throw refuse(
      'A "fail" needs a blocking standards finding, a missing or wrong criterion, or an unproven blast-radius item. Smells do not fail a review.'
    )
  }
  const summary =
    text(field(body, 'summary')) ||
    (verdict === 'pass'
      ? 'No blocking standards, spec, or blast-radius findings.'
      : findings[0]?.problem || 'Review failed.')
  return { verdict, summary, findings, axes }
}
