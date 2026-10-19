import { translate } from '@/i18n/i18n'
import type { FactorySkillCatalog } from '../../../../shared/factory-types'

/** Read-only skill list for Settings. Last synced comes from the lock; a missing time stays "not recorded". */
export function FactorySkillsTable(props: {
  repoName: string
  catalog: FactorySkillCatalog
}): React.JSX.Element {
  const synced = props.catalog.syncedAt
    ? translate('auto.components.settings.FactorySkillsTable.synced', 'Last synced {{value0}}', {
        value0: props.catalog.syncedAt
      })
    : translate(
        'auto.components.settings.FactorySkillsTable.notRecorded',
        'Last synced: not recorded'
      )
  return (
    <div className="space-y-2">
      <div className="text-[13px] font-medium text-foreground">
        {translate('auto.components.settings.FactorySkillsTable.title', 'Skills · {{value0}}', {
          value0: props.repoName
        })}
      </div>
      <p className="text-[12px] text-muted-foreground">{synced}</p>
      <div className="divide-y divide-border rounded-md border border-border">
        {props.catalog.entries.map((entry) => (
          <div
            key={`${entry.stage}-${entry.skill}`}
            className="flex items-center gap-3 px-3 py-1.5 text-[12px]"
          >
            <span className="w-28 shrink-0 text-muted-foreground">{entry.stage}</span>
            <span className="w-36 shrink-0 text-foreground">{entry.skill}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {entry.source
                ? `${entry.source} @ ${entry.pinnedCommit.slice(0, 12)}`
                : entry.pinnedCommit.slice(0, 12)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
