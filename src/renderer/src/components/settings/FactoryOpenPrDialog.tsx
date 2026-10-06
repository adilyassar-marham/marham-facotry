import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { FactoryOpenPrResult } from '../../../../shared/factory-run-types'

export type FactoryOpenPrTarget = {
  runId: string
  integrationBranch: string
  baseBranch: string | null
  defaultTitle: string
}

/** The person's explicit go: the only push a factory run ever makes. */
export function FactoryOpenPrDialog(props: {
  target: FactoryOpenPrTarget | null
  onClose: (opened: boolean) => void
}): React.JSX.Element {
  const { target, onClose } = props
  // Why no effect: the parent keys this dialog by run, so a new target mounts fresh state.
  const [title, setTitle] = useState(target?.defaultTitle ?? '')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Extract<FactoryOpenPrResult, { ok: false }> | null>(null)

  const open = async (): Promise<void> => {
    if (!target) {
      return
    }
    setBusy(true)
    try {
      const result = await window.api.factoryGate.openPullRequest({ runId: target.runId, title })
      if (result.ok) {
        void window.api.shell.openUrl(result.pullRequest.url)
        onClose(true)
      } else {
        setFailure(result)
      }
    } catch (error) {
      setFailure({
        ok: false,
        pushed: false,
        error: error instanceof Error ? error.message : String(error),
        compareUrl: null
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(next) => (next ? undefined : onClose(false))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.settings.FactoryOpenPrDialog.title', 'Open a draft PR')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.FactoryOpenPrDialog.description',
              'Orca pushes only {{value0}} to origin and opens a draft PR into {{value1}}. No other branch is pushed and nothing is merged.',
              {
                value0: target?.integrationBranch ?? '',
                value1:
                  target?.baseBranch ??
                  translate(
                    'auto.components.settings.FactoryOpenPrDialog.defaultBase',
                    'the default branch'
                  )
              }
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="factory-pr-title">
            {translate('auto.components.settings.FactoryOpenPrDialog.prTitle', 'PR title')}
          </Label>
          <Input
            id="factory-pr-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        {failure ? (
          <div className="space-y-1">
            <p className="text-[12px] text-destructive">{failure.error}</p>
            {failure.pushed ? (
              <p className="text-[12px] text-muted-foreground">
                {translate(
                  'auto.components.settings.FactoryOpenPrDialog.pushedOnly',
                  'The branch was pushed, but the PR could not be created here.'
                )}
              </p>
            ) : null}
            {failure.compareUrl ? (
              <Button
                variant="link"
                size="xs"
                onClick={() =>
                  failure.compareUrl ? void window.api.shell.openUrl(failure.compareUrl) : undefined
                }
              >
                {translate(
                  'auto.components.settings.FactoryOpenPrDialog.compare',
                  'Open the PR page on GitHub'
                )}
              </Button>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onClose(false)} disabled={busy}>
            {translate('auto.components.settings.FactoryOpenPrDialog.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => void open()} disabled={busy || !title.trim()}>
            {translate(
              'auto.components.settings.FactoryOpenPrDialog.confirm',
              'Push and open draft PR'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
