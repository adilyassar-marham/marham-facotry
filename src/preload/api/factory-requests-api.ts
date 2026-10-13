import type {
  FactoryRequestStartResult,
  FactoryRequestView
} from '../../shared/factory-request-types'

export type FactoryRequestsApi = {
  list: () => Promise<FactoryRequestView[]>
  create: (args: {
    repoId: string
    title: string
    description: string
    agent: string
  }) => Promise<FactoryRequestStartResult>
  answer: (args: { questionId: string; answer: string }) => Promise<void>
  decidePlan: (args: { runId: string; approve: boolean; feedback?: string }) => Promise<void>
  decideBrief: (args: { requestId: string; approve: boolean; feedback?: string }) => Promise<void>
  cancel: (args: { requestId: string }) => Promise<void>
}
