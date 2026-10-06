import type { FactoryGateStatus } from '../../shared/factory-types'
import type { FactoryOpenPrResult } from '../../shared/factory-run-types'

export type FactoryGateApi = {
  list: () => Promise<FactoryGateStatus[]>
  enable: (args: {
    repoId: string
    expectedCommand: string
    timeoutSeconds?: number
  }) => Promise<FactoryGateStatus>
  disable: (args: { repoId: string }) => Promise<FactoryGateStatus>
  saveSettings: (args: {
    repoId: string
    guidelines: string[]
    maxWorkers: number
    maxFixRounds: number
  }) => Promise<FactoryGateStatus>
  openPullRequest: (args: { runId: string; title?: string }) => Promise<FactoryOpenPrResult>
}
