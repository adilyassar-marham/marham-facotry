import { describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { FACTORY_EVAL_HANDLERS } from './factory-eval'

describe('factory eval command', () => {
  it('prints the benchmarks and does not call the runtime', async () => {
    const call = vi.fn()
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logs.push(String(line))
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this handler never reads the client.
    const client = { call } as unknown as RuntimeClient
    await FACTORY_EVAL_HANDLERS['factory eval']({
      flags: new Map(),
      client,
      cwd: process.cwd(),
      json: false
    })
    spy.mockRestore()
    expect(call).not.toHaveBeenCalled()
    expect(logs.join('\n')).toContain('does not launch agents')
    expect(logs.join('\n')).toContain('jazzcash')
  })
})
