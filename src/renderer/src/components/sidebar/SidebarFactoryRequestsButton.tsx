import React, { useState } from 'react'
import { Factory } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { lazyWithRetry } from '@/lib/lazy-with-retry'

const FactoryRequestsSheet = lazyWithRetry(async () => ({
  default: (await import('../factory-requests/FactoryRequestsSheet')).FactoryRequestsSheet
}))

/** Entry point for teammates who never touch a terminal: requests run through the factory. */
export function SidebarFactoryRequestsButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight text-worktree-sidebar-foreground/60 transition-colors hover:bg-worktree-sidebar-foreground/8"
      >
        <Factory
          className="size-4 shrink-0 text-worktree-sidebar-foreground/30"
          strokeWidth={1.75}
        />
        <span className="flex-1">
          {translate('auto.components.sidebar.SidebarFactoryRequestsButton.label', 'Requests')}
        </span>
      </button>
      {open ? (
        <React.Suspense fallback={null}>
          <FactoryRequestsSheet open={open} onOpenChange={setOpen} />
        </React.Suspense>
      ) : null}
    </>
  )
}
