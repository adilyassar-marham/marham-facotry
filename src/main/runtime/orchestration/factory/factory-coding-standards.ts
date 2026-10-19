import { FACTORY_DEFAULT_CODE_CONVENTIONS } from './factory-default-code-conventions'
import { FACTORY_EXPERIMENT_RULES } from './factory-experiment-rules'

const MARK = '\n## Coding standards\n'

/**
 * Every factory assignment carries the same rules: the worker who writes, the reviewer who
 * judges, and the worker who fixes a failed review.
 */
export function appendFactoryCodingStandards(spec: string): string {
  return [
    spec.trim(),
    '',
    '## Coding standards',
    'These rules apply to every line you add. If a rule blocks the task, stop and say so.',
    'Do not work around it.',
    '',
    FACTORY_DEFAULT_CODE_CONVENTIONS,
    '',
    FACTORY_EXPERIMENT_RULES.trim()
  ].join('\n')
}

/** Task text for a reviewer, without a second copy of the standards already printed once. */
export function stripFactoryCodingStandards(spec: string): string {
  const index = spec.indexOf(MARK)
  return (index === -1 ? spec : spec.slice(0, index)).trim()
}
