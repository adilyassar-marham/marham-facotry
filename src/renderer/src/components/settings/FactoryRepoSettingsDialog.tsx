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
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { FactoryGateStatus } from '../../../../shared/factory-types'

export type FactoryRepoSettingsDraft = {
  repoId: string
  guidelines: string[]
  maxWorkers: number
  maxFixRounds: number
}

/** Person-owned policy: what the reviewer checks against and how far the loop may run alone. */
export function FactoryRepoSettingsDialog(props: {
  gate: FactoryGateStatus | null
  busy: boolean
  onCancel: () => void
  onSave: (draft: FactoryRepoSettingsDraft) => void
}): React.JSX.Element {
  const { gate, busy, onCancel, onSave } = props
  // Why no effect: the parent keys this dialog by repo, so a new gate mounts fresh state.
  const [guidelines, setGuidelines] = useState(gate?.settings.guidelines.join('\n') ?? '')
  const [maxWorkers, setMaxWorkers] = useState(String(gate?.settings.maxWorkers ?? 3))
  const [maxFixRounds, setMaxFixRounds] = useState(String(gate?.settings.maxFixRounds ?? 3))

  const save = (): void => {
    if (!gate) {
      return
    }
    onSave({
      repoId: gate.repoId,
      guidelines: guidelines
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      maxWorkers: Number.parseInt(maxWorkers, 10),
      maxFixRounds: Number.parseInt(maxFixRounds, 10)
    })
  }

  return (
    <Dialog open={gate !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.settings.FactoryRepoSettingsDialog.title',
              'Factory settings for {{value0}}',
              { value0: gate?.repoName ?? '' }
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.settings.FactoryRepoSettingsDialog.description',
              'The reviewer checks every factory branch against these files, read from your main checkout so a run cannot edit the rules it is judged by.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="factory-guidelines">
              {translate(
                'auto.components.settings.FactoryRepoSettingsDialog.guidelines',
                'Guideline files (one repo-relative path per line)'
              )}
            </Label>
            <Textarea
              id="factory-guidelines"
              rows={4}
              value={guidelines}
              onChange={(event) => setGuidelines(event.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="factory-max-workers">
                {translate(
                  'auto.components.settings.FactoryRepoSettingsDialog.maxWorkers',
                  'Workers at once'
                )}
              </Label>
              <Input
                id="factory-max-workers"
                type="number"
                min={1}
                max={16}
                value={maxWorkers}
                onChange={(event) => setMaxWorkers(event.target.value)}
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="factory-max-fix-rounds">
                {translate(
                  'auto.components.settings.FactoryRepoSettingsDialog.maxFixRounds',
                  'Fix rounds before a person steps in'
                )}
              </Label>
              <Input
                id="factory-max-fix-rounds"
                type="number"
                min={1}
                max={10}
                value={maxFixRounds}
                onChange={(event) => setMaxFixRounds(event.target.value)}
              />
            </div>
          </div>
          <p className="text-[12px] leading-snug text-muted-foreground">
            {translate(
              'auto.components.settings.FactoryRepoSettingsDialog.note',
              'Limits apply to runs set up after you save.'
            )}
          </p>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {translate('auto.components.settings.FactoryRepoSettingsDialog.cancel', 'Cancel')}
          </Button>
          <Button onClick={save} disabled={busy}>
            {translate('auto.components.settings.FactoryRepoSettingsDialog.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
