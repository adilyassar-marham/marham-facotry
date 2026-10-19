import { Suspense } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { useFactoryTabOpen } from './use-factory-tab'

const FactoryWorkspace = lazy(async () => ({
  default: (await import('./FactoryRequestsSheet')).FactoryWorkspace
}))

/** 4px window-drag strip plus the 32px tab row. A shorter cover sits on the tabs. */
const FACTORY_PANE_CHROME_PX = 36

/** Covers the pane body while the Factory tab is selected. The tab strip stays usable. */
export function FactoryPaneOverlay(props: {
  groupId: string | undefined
}): React.JSX.Element | null {
  const open = useFactoryTabOpen()
  if (!open || !props.groupId) {
    return null
  }
  return (
    <div
      className="absolute right-0 bottom-0 left-0 z-20 overflow-hidden bg-background"
      style={{ top: FACTORY_PANE_CHROME_PX }}
    >
      <Suspense fallback={null}>
        <FactoryWorkspace />
      </Suspense>
    </div>
  )
}
