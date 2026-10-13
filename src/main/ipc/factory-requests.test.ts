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
const stopTerminals = vi.fn()
const signedInAgents = vi.fn(async () => new Set<string>(['cursor', 'claude', 'codex']))
const input = {
  repoId: 'repo_app',
  title: 'Show fee',
  description: 'Under the name.',
  agent: 'cursor'
}

function create(agent = 'cursor'): Promise<unknown> {
  return Promise.resolve(handlers.get('factoryRequests:create')?.({}, { ...input, agent }))
}

describe('factory request IPC', () => {
  beforeEach(() => {
    handlers.clear()
    launch.mockReset()
    stopTerminals.mockReset()
    stopTerminals.mockResolvedValue(undefined)
    signedInAgents.mockReset()
    signedInAgents.mockResolvedValue(new Set(['cursor', 'claude', 'codex']))
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
        stopTerminalsForWorktree: stopTerminals
      },
      launch,
      signedInAgents
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

  it('stops a helper that starts after the requester already stopped the request', async () => {
    launch.mockImplementation(async () => {
      const row = db.listFactoryRequests()[0]
      if (!row) {
        throw new Error('missing request')
      }
      db.cancelFactoryRequest(row.id)
      return { worktreeId: 'repo_app::/w/late' }
    })

    await create()

    expect(db.listFactoryRequests()[0]).toMatchObject({ cancelled: 1, worktree_id: null })
    expect(stopTerminals).toHaveBeenCalledWith('id:repo_app::/w/late')
  })

  it('uses the helper the person chose', async () => {
    signedInAgents.mockResolvedValue(new Set(['cursor']))
    launch.mockResolvedValue({ worktreeId: 'repo_app::/w/claude' })

    await create('claude')

    expect(db.listFactoryRequests()[0]?.agent).toBe('claude')
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude' }))
  })

  it('lists the helpers that are already signed in', async () => {
    signedInAgents.mockResolvedValue(new Set(['cursor', 'codex']))

    const listed = await handlers.get('factoryRequests:signedInAgents')?.({}, {})

    expect(listed).toEqual(['cursor', 'codex'])
  })
})
