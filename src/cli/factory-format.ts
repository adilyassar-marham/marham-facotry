import type {
  FactoryBoard,
  FactoryGateStatus,
  FactoryLandResult,
  FactoryPlanApplyResult,
  FactoryVerifySummary
} from '../shared/factory-types'

export function formatFactoryPlan(result: FactoryPlanApplyResult): string {
  return [
    `Created ${result.tasks.length} task(s) in ${result.runId}:`,
    ...result.tasks.map((task) => `  ${task.key} → ${task.taskId}`)
  ].join('\n')
}

export function formatFactoryVerify(result: {
  gated: boolean
  command: string | null
  verify: FactoryVerifySummary | null
}): string {
  if (!result.gated || !result.verify) {
    return 'No factory gate applies to this task (its repo has no approved verify, or it has no worker worktree).'
  }
  const seconds = Math.round((result.verify.durationMs ?? 0) / 1000)
  return [
    `Verify ${result.verify.status.toUpperCase()} in ${seconds}s${result.command ? `: ${result.command}` : ''}`,
    result.verify.outputTail.trim()
  ]
    .filter(Boolean)
    .join('\n')
}

export function formatFactoryBoard(board: FactoryBoard): string {
  if (!board.runId) {
    return 'No orchestration run yet. Create one, then `orca factory plan --file <plan.json>`.'
  }
  const rows = board.tasks.map((task) => {
    const deps = task.deps.length > 0 ? `  ← ${task.deps.join(', ')}` : ''
    return `  ${task.stage.padEnd(13)} ${task.taskId}  ${task.title}${deps}`
  })
  return [`${board.runId}: ${board.objective ?? ''}`.trim(), ...rows].join('\n')
}

export function formatFactoryLand(result: FactoryLandResult): string {
  const lines = [`Integration branch ${result.integrationBranch}`]
  for (const step of result.steps) {
    lines.push(
      step.outcome === 'merged'
        ? `  merged      ${step.taskId}  ${step.mergeCommit.slice(0, 10)}`
        : step.outcome === 'already_landed'
          ? `  landed      ${step.taskId}`
          : `  CONFLICT    ${step.taskId}  ${step.files.join(', ')}`
    )
  }
  for (const skip of result.skipped) {
    lines.push(`  skipped     ${skip.taskId}  ${skip.reason}`)
  }
  if (result.stoppedOnConflict) {
    lines.push('Stopped at the conflict; the merge was aborted and the branch is clean.')
  }
  if (result.integrationVerify) {
    lines.push(`Integration verify: ${result.integrationVerify.status.toUpperCase()}`)
  }
  return lines.join('\n')
}

export function formatFactoryGates(result: { gates: FactoryGateStatus[] }): string {
  if (result.gates.length === 0) {
    return 'No repos.'
  }
  return result.gates
    .map((gate) => {
      const state = gate.stale ? 'STALE (re-approve)' : gate.enabled ? 'on' : 'off'
      const detail = gate.unsupportedReason ?? gate.command ?? ''
      return `  ${state.padEnd(18)} ${gate.repoName}  ${detail}`
    })
    .join('\n')
}
