import type { FactoryReviewFinding } from '../../../../shared/factory-run-types'
import {
  appendFactoryCodingStandards,
  stripFactoryCodingStandards
} from './factory-coding-standards'
import { FACTORY_REVIEW_REPORT_SHAPE } from './factory-review-report'

const REPORT_PATH = '.orca/factory-review.json'

/** Secrets and signing material: a diff that touches these never reaches a PR without a person. */
const BLOCKED_PATH_RULES: { pattern: RegExp; why: string }[] = [
  { pattern: /(^|\/)orca\.yaml$/, why: 'orca.yaml defines the quality gate itself' },
  { pattern: /(^|\/)\.env(\.(?!example$|sample$|template$)[^/]+)?$/, why: 'environment secrets' },
  {
    pattern: /\.(jks|keystore|p12|pfx|pem|key|p8|mobileprovision)$/i,
    why: 'signing keys or certificates'
  },
  { pattern: /(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/, why: 'SSH private keys' },
  { pattern: /(^|\/)(credentials|service-account[^/]*)\.json$/i, why: 'service credentials' }
]

export function findBlockedPaths(
  changedFiles: readonly string[],
  guidelines: readonly string[]
): FactoryReviewFinding[] {
  const findings: FactoryReviewFinding[] = []
  for (const file of changedFiles) {
    if (guidelines.includes(file)) {
      findings.push({
        rule: 'Factory: guidelines are not edited by the run they judge',
        file,
        problem: `${file} is a review guideline file, and this run changed it.`,
        fix: `Revert the change to ${file}; a person updates guidelines outside the factory.`
      })
      continue
    }
    const hit = BLOCKED_PATH_RULES.find((rule) => rule.pattern.test(file))
    if (hit) {
      findings.push({
        rule: 'Factory: no secrets or gate config in a factory PR',
        file,
        problem: `${file} looks like ${hit.why}.`,
        fix: `Remove ${file} from the branch (git rm --cached if it must stay local).`
      })
    }
  }
  return findings
}

function formatFinding(finding: FactoryReviewFinding): string {
  const where = finding.file ? ` (${finding.file}${finding.line ? `:${finding.line}` : ''})` : ''
  return `- [${finding.rule}]${where} ${finding.problem}${finding.fix ? ` → ${finding.fix}` : ''}`
}

export function buildFactoryReviewSpec(params: {
  runId: string
  round: number
  integrationBranch: string
  headSha: string
  baseSha: string
  guidelineFiles: string[]
  taskSpecs: { title: string; spec: string }[]
  previousFindings: FactoryReviewFinding[]
}): string {
  return appendFactoryCodingStandards(
    [
      `You are the guideline reviewer for factory run ${params.runId}, round ${params.round}.`,
      'You review. You do not edit, commit, merge, or push anything.',
      '',
      `Branch under review: ${params.integrationBranch} at ${params.headSha}.`,
      `Review only what this run changed: \`git diff ${params.baseSha}...${params.headSha}\`.`,
      '',
      '## Extra guideline files (read these too, when present)',
      ...(params.guidelineFiles.length > 0
        ? params.guidelineFiles.map((file) => `- ${file}`)
        : ['- (none — the coding standards in this assignment are the rules)']),
      '',
      '## What each task was asked to do',
      ...params.taskSpecs.flatMap((task) => [
        `### ${task.title}`,
        stripFactoryCodingStandards(task.spec),
        ''
      ]),
      ...(params.previousFindings.length > 0
        ? [
            '## Findings from the previous round (confirm each is fixed)',
            ...params.previousFindings.map(formatFinding),
            ''
          ]
        : []),
      '## How to judge',
      '- Check every changed line against the coding standards in this assignment and each acceptance criterion.',
      '- Pre-existing code the diff did not touch is out of scope.',
      '- Each finding names the rule it breaks, the file and line, the problem, and the exact fix.',
      '- Any finding means verdict "fail"; no findings means "pass". Do not soften either way.',
      '',
      '## Report',
      `Write the report to ${REPORT_PATH} in your worktree, shaped like:`,
      FACTORY_REVIEW_REPORT_SHAPE,
      'Then report with the same Orca CLI you were started with (orca or orca-dev):',
      `orca orchestration send --type worker_done --outcome succeeded --report-path ${REPORT_PATH}`,
      'If you cannot review (missing files, broken checkout), send worker_done --outcome failed.'
    ].join('\n')
  )
}

export function buildFactoryFixSpec(params: {
  round: number
  integrationBranch: string
  guidelineFiles: string[]
  findings: FactoryReviewFinding[]
}): string {
  return appendFactoryCodingStandards(
    [
      `Fix the findings from guideline review round ${params.round} on ${params.integrationBranch}.`,
      'Your worktree must start from that branch (worker-start --base-branch).',
      '',
      '## Findings to fix',
      ...params.findings.map(formatFinding),
      ...(params.guidelineFiles.length > 0
        ? ['', '## Extra guideline files', ...params.guidelineFiles.map((file) => `- ${file}`)]
        : []),
      '',
      '## Acceptance criteria',
      '- Every finding above is resolved exactly as its rule requires.',
      '- Nothing else changes: no refactors, renames, or cleanup beyond the findings.',
      '- All work is committed before worker_done; the repo verify command passes.'
    ].join('\n')
  )
}
