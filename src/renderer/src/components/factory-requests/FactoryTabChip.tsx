import { Factory } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { setFactoryTabOpen } from './factory-tab-store'
import { useFactoryTabOpen } from './use-factory-tab'

/** A workspace tab. Choosing it shows the factory; choosing any other tab leaves it. */
export function FactoryTabChip(): React.JSX.Element {
  const open = useFactoryTabOpen()
  return (
    <button
      type="button"
      data-factory-tab=""
      data-current={open}
      aria-pressed={open}
      // Why: the tab row is a window drag region and swallows this press without no-drag.
      onPointerDown={(event) => {
        event.stopPropagation()
        setFactoryTabOpen(true)
      }}
      onClick={() => setFactoryTabOpen(true)}
      className="right-sidebar-header-no-drag flex h-full shrink-0 items-center gap-1.5 border-r border-border px-3 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground data-[current=true]:bg-background data-[current=true]:text-foreground"
    >
      <Factory className="size-3.5 shrink-0" strokeWidth={1.75} />
      {translate('auto.components.factoryRequests.tab.label', 'Factory')}
    </button>
  )
}
