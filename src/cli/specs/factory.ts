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
    path: ['factory', 'baseline'],
    summary: 'Create the run’s factory/<run> branch, install dependencies, and verify the base',
    usage:
      'orca factory baseline --run <run-id> [--request <request-id>] [--base <branch>] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'base', 'worktree', 'request'],
    examples: ['orca factory baseline --run run_abc123']
  },
  {
    path: ['factory', 'ask'],
    summary: 'Ask the requester one plain-language question and wait for the answer',
    usage:
      'orca factory ask (--request <request-id> | --run <run-id>) (--question <text> | --question-id <id>) [--choice <text> ...] [--recommended <n>] [--why <text>] [--wait-seconds <n>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'run',
      'request',
      'question',
      'question-id',
      'choice',
      'recommended',
      'why',
      'wait-seconds'
    ],
    notes: [
      'Before a run exists, ask with --request and 2-4 --choice values. --recommended is 1 for the first choice.',
      'Answers "waiting" when time runs out; ask again with --question-id to keep waiting.'
    ]
  },
  {
    path: ['factory', 'say'],
    summary: 'Post a plain-language note on the request for the requester to read',
    usage: 'orca factory say --request <request-id> --text "..." [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'request', 'text']
  },
  {
    path: ['factory', 'brief'],
    summary: 'Submit the two-layer brief for the requester to approve',
    usage: 'orca factory brief --request <request-id> --file <brief.json> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'request', 'file'],
    notes: [
      'The file is { "person", "agent", "kind", "acceptance" }. kind is app_only, needs_backend, app_and_backend, needs_native, or not_feasible.',
      'A draft is replaced in place. After the requester asks for changes, the next submit is a new version.'
    ]
  },
  {
    path: ['factory', 'await-brief'],
    summary: 'Wait until the requester approves the brief or asks for changes',
    usage: 'orca factory await-brief --request <request-id> [--wait-seconds <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'request', 'wait-seconds'],
    notes: ['APPROVED prints the agent brief. Build that text, not the original request.']
  },
  {
    path: ['factory', 'await-approval'],
    summary: 'Wait for the requester to approve or send back the plan',
    usage: 'orca factory await-approval --run <run-id> [--wait-seconds <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'wait-seconds']
  },
  {
    path: ['factory', 'review'],
    summary: 'Open the next guideline review round for the run’s integration branch',
    usage: 'orca factory review --run <run-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run']
  },
  {
    path: ['factory', 'fix'],
    summary: 'Create the fix task for the latest failed review round',
    usage: 'orca factory fix --run <run-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run']
  },
  {
    path: ['factory', 'cleanup'],
    summary: 'Remove clean worktrees of landed and reviewed tasks',
    usage: 'orca factory cleanup --run <run-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run']
  },
  {
    path: ['factory', 'gate', 'status'],
    summary: 'Show the factory quality gate for each repo (approve it in Settings)',
    usage: 'orca factory gate status [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  }
]
