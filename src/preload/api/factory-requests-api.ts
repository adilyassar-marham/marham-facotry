import type {
  FactoryRequestCreateResult,
  FactoryRequestView
} from '../../shared/factory-request-types'

export type FactoryRequestsApi = {
  list: () => Promise<FactoryRequestView[]>
  create: (args: {
    repoId: string
    title: string
    description: string
    agent: string
  }) => Promise<FactoryRequestCreateResult>
  attachWorktree: (args: { requestId: string; worktreeId: string }) => Promise<void>
  answer: (args: { questionId: string; answer: string }) => Promise<void>
  decidePlan: (args: { runId: string; approve: boolean; feedback?: string }) => Promise<void>
  cancel: (args: { requestId: string }) => Promise<void>
}
