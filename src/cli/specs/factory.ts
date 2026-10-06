import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const FACTORY_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['factory', 'plan'],
    summary: 'Create a whole task graph from a plan file, atomically',
    usage: 'orca factory plan --file <plan.json> [--run <run-id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'file', 'run'],
    examples: ['orca factory plan --file .orca/plan.json']
  },
  {
    path: ['factory', 'verify'],
    summary: "Run the repo's approved verify command against a task's worktree",
    usage: 'orca factory verify --task <task-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'task']
  },
  {
    path: ['factory', 'board'],
    summary: 'Show each task of a run and where it sits on the factory line',
    usage: 'orca factory board [--run <run-id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run']
  },
  {
    path: ['factory', 'land'],
    summary: 'Merge verified tasks onto the run’s factory/<run> integration branch',
    usage: 'orca factory land --run <run-id> [--base <branch>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'base'],
    examples: ['orca factory land --run run_abc123']
  },
  {
    path: ['factory', 'gate', 'status'],
    summary: 'Show the factory quality gate for each repo (approve it in Settings)',
    usage: 'orca factory gate status [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  }
]
