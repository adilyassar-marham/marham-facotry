// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FactoryRunReport } from '../../../../shared/factory-run-types'
import { FactoryRunSection } from './FactoryRunSection'

const check = {
  id: 'fchk_1',
  kind: 'integration' as const,
  headSha: 'abcdef1234',
  status: 'passed' as const,
  exitCode: 0,
  timedOut: false,
  durationMs: 10,
  outputTail: '',
  completedAt: null
}

const report = (overrides: Partial<FactoryRunReport>): FactoryRunReport => ({
  repoId: 'repo_app',
  baseBranch: 'master',
  integrationBranch: 'factory/run_1',
  integrationWorktreePath: '/w/factory-run_1',
  maxWorkers: 3,
  maxFixRounds: 3,
  baseline: { ...check, kind: 'baseline' },
  integration: check,
  reviews: [],
  fixRoundsUsed: 0,
  pullRequest: null,
  prReadiness: { ready: false, reasons: ['No guideline review has passed yet.'] },
  gateRefusals: 2,
  skills: [],
  ...overrides
})

let root: Root
let host: HTMLDivElement
const api = { openPullRequest: vi.fn() }
const shell = { openUrl: vi.fn() }

const buttonNamed = (name: string): HTMLButtonElement | undefined =>
  Array.from(document.body.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === name
  )

async function render(value: FactoryRunReport): Promise<void> {
  await act(async () => {
    root.render(
      <FactoryRunSection runId="run_1" objective="Fix tsc" report={value} onChanged={vi.fn()} />
    )
  })
}

describe('FactoryRunSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, { api: { factoryGate: api, shell } })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('keeps the PR button off and says why until Orca says the run is ready', async () => {
    await render(report({}))
    expect(buttonNamed('Open draft PR')?.disabled).toBe(true)
    expect(host.textContent).toContain('No guideline review has passed yet.')
  })

  it('pushes and opens the PR only after the person confirms', async () => {
    await render(report({ prReadiness: { ready: true, reasons: [] } }))
    await act(async () => buttonNamed('Open draft PR')?.click())
    expect(document.body.textContent).toContain('pushes only factory/run_1')
    expect(api.openPullRequest).not.toHaveBeenCalled()

    api.openPullRequest.mockResolvedValue({
      ok: true,
      pullRequest: { url: 'https://example.test/pr/7', number: 7 }
    })
    await act(async () => buttonNamed('Push and open draft PR')?.click())
    expect(api.openPullRequest).toHaveBeenCalledWith({ runId: 'run_1', title: 'Fix tsc' })
    expect(shell.openUrl).toHaveBeenCalledWith('https://example.test/pr/7')
  })
})
