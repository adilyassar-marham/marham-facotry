import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { registerFactoryRequestHandlers } from './factory-requests'

const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>()
vi.mock('electron', () => ({
  app: { isPackaged: false },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, raw: unknown) => unknown) =>
      handlers.set(channel, handler),
    removeHandler: vi.fn()
  }
}))

let db: OrchestrationDb
const repo: Repo = {
  id: 'repo_app',
  path: '/r/app',
  displayName: 'app',
  badgeColor: '',
  addedAt: 0
}
const launch = vi.fn()
const input = {
  repoId: 'repo_app',
  title: 'Show fee',
  description: 'Under the name.',
  agent: 'cursor'
}

function create(): Promise<unknown> {
  return Promise.resolve(handlers.get('factoryRequests:create')?.({}, input))
}

describe('factory request IPC', () => {
  beforeEach(() => {
    handlers.clear()
    launch.mockReset()
    db = new OrchestrationDb(':memory:')
    db.approveFactoryGate({
      repoId: 'repo_app',
      contentHash: 'h',
      command: 'x',
      timeoutSeconds: 60
    })
    registerFactoryRequestHandlers(
      {
        listRepos: () => [repo],
        getOrchestrationDb: () => db,
        stopTerminalsForWorktree: vi.fn()
      },
      launch
    )
  })
  afterEach(() => db.close())

  it('launches the coordinator in its own workspace and links it to the request', async () => {
    launch.mockResolvedValue({ worktreeId: 'repo_app::/w/factory-request' })
    const result = await create()
    const [row] = db.listFactoryRequests()
    expect(result).toEqual({
      requestId: row.id,
      worktreeId: 'repo_app::/w/factory-request'
    })
    expect(row).toMatchObject({
      worktree_id: 'repo_app::/w/factory-request',
      cancelled: 0
    })
    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({ repoId: 'repo_app', agent: 'cursor' })
    )
    expect(launch.mock.calls[0][0].prompt).toContain('orca-dev factory')
  })

  it('cancels the request when its agent never starts, instead of leaving it "Starting"', async () => {
    launch.mockRejectedValue(new Error('agent_not_installed'))
    await expect(create()).rejects.toThrow('agent_not_installed')
    expect(db.listFactoryRequests()[0]).toMatchObject({
      worktree_id: null,
      cancelled: 1
    })
  })
})
