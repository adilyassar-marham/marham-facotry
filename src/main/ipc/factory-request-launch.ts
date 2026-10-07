import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { ALL_RPC_METHODS } from '../runtime/rpc/methods'

export type FactoryCoordinatorLaunch = (params: {
  repoId: string
  agent: string
  workspaceName: string
  prompt: string
}) => Promise<{ worktreeId: string }>

function readWorktreeId(result: unknown): string {
  const worktreeId =
    typeof result === 'object' && result !== null
      ? Object.getOwnPropertyDescriptor(result, 'worktreeId')?.value
      : undefined
  if (typeof worktreeId !== 'string' || !worktreeId) {
    throw new Error('The agent started without a workspace.')
  }
  return worktreeId
}

/**
 * Launches as the host itself, not as the renderer's runtime client: the person at this computer
 * owns the workspace, and a client-attributed create needs a paired-device identity it lacks.
 */
export function createFactoryCoordinatorLauncher(
  runtime: OrcaRuntimeService
): FactoryCoordinatorLaunch {
  return async ({ repoId, agent, workspaceName, prompt }) => {
    const response = await new RpcDispatcher({
      runtime,
      methods: ALL_RPC_METHODS
    }).dispatch({
      id: 'factory-request-launch',
      authToken: 'desktop-ipc',
      method: 'agent.launch',
      params: {
        agent,
        target: {
          kind: 'create-worktree',
          create: { repo: `id:${repoId}`, name: workspaceName }
        },
        prompt: { text: prompt, delivery: 'submit' }
      }
    })
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return { worktreeId: readWorktreeId(response.result) }
  }
}
