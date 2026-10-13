import { createHash } from 'node:crypto'
import { loadHooks } from '../../../hooks'
import { readShippedFactoryScripts } from './factory-shipped-config'
import {
  FACTORY_VERIFY_DEFAULT_TIMEOUT_SECONDS,
  FACTORY_VERIFY_MAX_TIMEOUT_SECONDS
} from '../../../../shared/factory-types'

const OUTPUT_TAIL_CHARS = 4000

/**
 * Read from the repo's primary checkout, never the worker's worktree: a worker can edit its own
 * copy of orca.yaml, and a gate whose command the gated agent can rewrite is no gate.
 */
export function readFactoryVerifyCommand(primaryCheckoutPath: string): string | undefined {
  return (
    loadHooks(primaryCheckoutPath)?.scripts.verify?.trim() ||
    readShippedFactoryScripts(primaryCheckoutPath)?.verify
  )
}

/** Same normalization as the renderer's hook-trust hash, so the two never disagree on "changed". */
export function hashFactoryVerifyCommand(command: string): string {
  return createHash('sha256').update(command.trim(), 'utf8').digest('hex')
}

export function clampFactoryVerifyTimeoutSeconds(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return FACTORY_VERIFY_DEFAULT_TIMEOUT_SECONDS
  }
  return Math.min(Math.floor(value), FACTORY_VERIFY_MAX_TIMEOUT_SECONDS)
}

export function tailFactoryVerifyOutput(output: string): string {
  return output.length <= OUTPUT_TAIL_CHARS ? output : output.slice(-OUTPUT_TAIL_CHARS)
}
