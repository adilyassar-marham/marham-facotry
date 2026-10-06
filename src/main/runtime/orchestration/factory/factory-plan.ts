import type { FactoryPlanTaskInput } from '../../../../shared/factory-types'
import { OrchestrationError } from '../orchestration-error'
import type { OrchestrationDb } from '../db'

const MAX_PLAN_TASKS = 100
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i

function invalid(message: string): OrchestrationError {
  return new OrchestrationError('invalid_argument', `Invalid factory plan: ${message}`)
}

/** Returns the tasks dependencies-first; throws on anything a partial create would have to undo. */
export function orderFactoryPlan(tasks: readonly FactoryPlanTaskInput[]): FactoryPlanTaskInput[] {
  if (tasks.length === 0) {
    throw invalid('it has no tasks.')
  }
  if (tasks.length > MAX_PLAN_TASKS) {
    throw invalid(`${tasks.length} tasks exceeds the ${MAX_PLAN_TASKS}-task limit; split the plan.`)
  }
  const byKey = new Map<string, FactoryPlanTaskInput>()
  for (const task of tasks) {
    if (!KEY_PATTERN.test(task.key)) {
      throw invalid(`key "${task.key}" must be 1-64 letters, digits, dot, dash or underscore.`)
    }
    if (byKey.has(task.key)) {
      throw invalid(`key "${task.key}" appears twice.`)
    }
    if (!task.spec.trim()) {
      throw invalid(`task "${task.key}" has an empty spec.`)
    }
    byKey.set(task.key, task)
  }
  for (const task of tasks) {
    for (const dep of task.deps ?? []) {
      if (dep === task.key) {
        throw invalid(`task "${task.key}" depends on itself.`)
      }
      if (!byKey.has(dep)) {
        throw invalid(`task "${task.key}" depends on unknown key "${dep}".`)
      }
    }
  }
  const ordered: FactoryPlanTaskInput[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (key: string, path: string[]): void => {
    const mark = state.get(key)
    if (mark === 'done') {
      return
    }
    if (mark === 'visiting') {
      throw invalid(`dependency cycle ${[...path, key].join(' → ')}.`)
    }
    state.set(key, 'visiting')
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every dep key was checked against byKey above.
    const task = byKey.get(key) as FactoryPlanTaskInput
    for (const dep of task.deps ?? []) {
      visit(dep, [...path, key])
    }
    state.set(key, 'done')
    ordered.push(task)
  }
  for (const task of tasks) {
    visit(task.key, [])
  }
  return ordered
}

/** Acceptance criteria ride in the spec, so every worker preamble and reviewer sees them. */
export function buildFactoryTaskSpec(task: FactoryPlanTaskInput): string {
  const criteria = (task.acceptance ?? []).map((line) => line.trim()).filter(Boolean)
  if (criteria.length === 0) {
    return task.spec.trim()
  }
  return [
    task.spec.trim(),
    '',
    '## Acceptance criteria',
    ...criteria.map((line) => `- ${line}`),
    '',
    'Done means every criterion above holds and the repo verify command passes.'
  ].join('\n')
}

/**
 * With the gate on anywhere, a plan needs a baseline first. A red baseline means every task fails
 * the gate until someone fixes the base, so exactly one root task may exist and it goes first.
 */
export function assertFactoryPlanFitsBaseline(
  db: OrchestrationDb,
  runId: string,
  tasks: readonly FactoryPlanTaskInput[]
): void {
  const factoryRun = db.getFactoryRun(runId)
  if (!factoryRun) {
    if (db.listFactoryGateApprovals().length > 0) {
      throw new OrchestrationError(
        'factory_baseline_required',
        `Run \`orca factory baseline --run ${runId}\` before planning: it creates factory/${runId}, ` +
          'installs dependencies, and checks whether the base already passes verify.'
      )
    }
    return
  }
  const baseline = db.getLatestFactoryCheck(runId, 'baseline')
  if (!baseline || baseline.status === 'passed') {
    return
  }
  if (baseline.status === 'not_approved') {
    throw new OrchestrationError(
      'factory_verify_not_approved',
      'The verify command changed since it was approved. A person must re-approve it in Settings.'
    )
  }
  const roots = tasks.filter((task) => (task.deps ?? []).length === 0)
  if (roots.length > 1) {
    throw invalid(
      `the baseline on factory/${runId} fails verify, so ${roots.length} independent tasks would ` +
        'each fail the gate. Make ONE root task that makes the baseline pass, and make every ' +
        `other task depend on it. Baseline output:\n${baseline.output_tail.slice(-1500)}`
    )
  }
}

/** All-or-nothing: a plan that fails halfway would leave dependents pointing at nothing. */
export function applyFactoryPlan(
  db: OrchestrationDb,
  params: {
    runId: string
    tasks: readonly FactoryPlanTaskInput[]
    createdByTerminalHandle?: string
  }
): { key: string; taskId: string }[] {
  const ordered = orderFactoryPlan(params.tasks)
  assertFactoryPlanFitsBaseline(db, params.runId, ordered)
  const ids = new Map<string, string>()
  db.db.exec('SAVEPOINT factory_plan_apply')
  try {
    for (const task of ordered) {
      const created = db.createTask({
        runId: params.runId,
        spec: buildFactoryTaskSpec(task),
        taskTitle: task.title?.trim() || undefined,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: orderFactoryPlan emits dependencies before dependents.
        deps: (task.deps ?? []).map((dep) => ids.get(dep) as string),
        createdByTerminalHandle: params.createdByTerminalHandle
      })
      ids.set(task.key, created.id)
    }
    db.db.exec('RELEASE factory_plan_apply')
  } catch (error) {
    db.db.exec('ROLLBACK TO factory_plan_apply')
    db.db.exec('RELEASE factory_plan_apply')
    throw error
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: every key was created in the loop above.
  return params.tasks.map((task) => ({ key: task.key, taskId: ids.get(task.key) as string }))
}
