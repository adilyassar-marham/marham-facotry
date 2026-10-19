import { useEffect } from 'react'
import { Factory } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { setFactoryTabOpen } from '../factory-requests/factory-tab-store'
import { useFactoryTabOpen } from '../factory-requests/use-factory-tab'

/** Opens the factory. It only stays pressed while that screen is the one in front. */
export function SidebarFactoryRequestsButton(): React.JSX.Element {
  const open = useFactoryTabOpen()
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const showing = open && activeView === 'terminal'
  useEffect(() => {
    setFactoryTabOpen(true)
    return () => setFactoryTabOpen(false)
  }, [])
  useEffect(() => {
    if (activeView !== 'terminal') {
      setFactoryTabOpen(false)
    }
  }, [activeView])
  return (
    <button
      type="button"
      data-current={showing}
      aria-pressed={showing}
      onClick={() => {
        setActiveView('terminal')
        setFactoryTabOpen(true)
      }}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight text-worktree-sidebar-foreground/60 transition-colors hover:bg-worktree-sidebar-foreground/8 data-[current=true]:bg-worktree-sidebar-foreground/8 data-[current=true]:text-worktree-sidebar-foreground"
    >
      <Factory className="size-4 shrink-0 text-worktree-sidebar-foreground/30" strokeWidth={1.75} />
      <span className="flex-1">
        {translate('auto.components.sidebar.SidebarFactoryRequestsButton.label', 'Marham Factory')}
      </span>
    </button>
  )
}
