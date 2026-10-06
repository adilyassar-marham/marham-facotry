import type { FactoryGateStatus } from '../../shared/factory-types'

export type FactoryGateApi = {
  list: () => Promise<FactoryGateStatus[]>
  enable: (args: {
    repoId: string
    expectedCommand: string
    timeoutSeconds?: number
  }) => Promise<FactoryGateStatus>
  disable: (args: { repoId: string }) => Promise<FactoryGateStatus>
}
