import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import type { FactoryGateStatus } from '../../../../shared/factory-types'

/** The trust decision: shows the exact command so the person approves what will actually run. */
export function FactoryGateApprovalDialog(props: {
  gate: FactoryGateStatus | null
  busy: boolean
  onCancel: () => void
  onApprove: (gate: FactoryGateStatus) => void
}): React.JSX.Element {
  const { gate, busy, onCancel, onApprove } = props
  return (
    <Dialog open={gate !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.FactoryGateApprovalDialog.title',
              'Approve the factory quality gate'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.FactoryGateApprovalDialog.description',
              'Orca will run this command in each worker’s worktree before any task in {{value0}} can be marked done. Approve only commands you trust. If orca.yaml changes it later, tasks stop completing until you approve again.',
              { value0: gate?.repoName ?? '' }
            )}
          </DialogDescription>
        </DialogHeader>
        <pre className="scrollbar-sleek max-h-48 overflow-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-foreground">
          {gate?.command ?? ''}
        </pre>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {translate('auto.components.settings.FactoryGateApprovalDialog.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => (gate ? onApprove(gate) : undefined)} disabled={busy}>
            {translate(
              'auto.components.settings.FactoryGateApprovalDialog.approve',
              'Approve and enable'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
