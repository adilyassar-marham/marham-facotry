import { readFactorySkillAllowlist } from '../../shared/factory-skill-allowlist'
import { inspectFactorySkills } from '../../shared/factory-skill-lock'
import { syncFactorySkills } from '../../shared/factory-skill-sync'
import type { CommandHandler } from '../dispatch'
import { getDefaultUserDataPath } from '../runtime/metadata'
import { RuntimeClientError } from '../runtime-client'

function printLocal(json: boolean, value: unknown, text: string): void {
  console.log(json ? JSON.stringify(value, null, 2) : text)
}

export const FACTORY_SKILL_HANDLERS: Record<string, CommandHandler> = {
  'factory skills status': async ({ cwd, json }) => {
    const status = inspectFactorySkills(cwd)
    printLocal(json, status, status.text)
  },
  // Why local, not RPC: an agent can call every RPC method. Sync fetches whatever the lock names.
  'factory skills sync': async ({ cwd, client, json }) => {
    let activeRun = true
    try {
      const status = await client.call<{ activeRun: boolean }>('factory.skillsStatus', {
        path: cwd
      })
      activeRun = status.result.activeRun
    } catch {
      throw new RuntimeClientError(
        'runtime_unavailable',
        'Skills sync could not confirm this repo has no active factory run. Start Orca and try again.'
      )
    }
    try {
      const result = await syncFactorySkills(cwd, {
        allowlist: readFactorySkillAllowlist(getDefaultUserDataPath()),
        activeRun
      })
      printLocal(
        json,
        result,
        `Vendored ${result.skills} skills (${result.files} files) into .agents/skills. ` +
          'Review the diff and commit it. Nothing was pushed.'
      )
    } catch (error) {
      if (error instanceof RuntimeClientError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new RuntimeClientError('invalid_argument', message)
    }
  }
}
