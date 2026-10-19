import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  FACTORY_EVAL_BENCHMARKS,
  buildFactoryEvalReport,
  parseFactoryEvalObservations,
  renderFactoryEvalReport
} from '../../shared/factory-eval'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'

function printLocal(json: boolean, value: unknown, text: string): void {
  console.log(json ? JSON.stringify(value, null, 2) : text)
}

function instructions(): string {
  const lines = [
    'Factory eval does not launch agents and does not use the network.',
    'Run each request in docs/factory/evals/ by hand on a throwaway branch, once with the skill pack and once without.',
    'Record both arms in a JSON file of { "runs": [ ... ] } and pass it with --file.',
    'Do not put patient names, numbers, or histories in that file.',
    '',
    'Benchmarks:'
  ]
  for (const benchmark of FACTORY_EVAL_BENCHMARKS) {
    lines.push(`- ${benchmark.id}: ${benchmark.title}`)
  }
  return lines.join('\n')
}

export const FACTORY_EVAL_HANDLERS: Record<string, CommandHandler> = {
  'factory eval': async ({ flags, cwd, json }) => {
    const file = getOptionalStringFlag(flags, 'file')
    if (!file) {
      printLocal(
        json,
        { launchesAgents: false, benchmarks: FACTORY_EVAL_BENCHMARKS },
        instructions()
      )
      return
    }
    let raw: string
    try {
      raw = await readFile(resolve(cwd, file), 'utf8')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new RuntimeClientError('invalid_argument', `Cannot read eval file ${file}: ${reason}`)
    }
    try {
      const report = buildFactoryEvalReport(parseFactoryEvalObservations(raw))
      printLocal(json, report, renderFactoryEvalReport(report))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new RuntimeClientError('invalid_argument', message)
    }
  }
}
