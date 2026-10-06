import { Factory } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { FactoryBoardSection } from './FactoryBoardSection'
import { FactoryGateSection } from './FactoryGateSection'

export function FactoryPanel(): React.JSX.Element {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Factory className="mt-0.5 size-5 text-muted-foreground" />
        <div className="space-y-1">
          <div className="text-[14px] font-medium text-foreground">
            {translate('auto.components.settings.FactoryPanel.title', 'Software factory')}
          </div>
          <p className="text-[12px] leading-snug text-muted-foreground">
            {translate(
              'auto.components.settings.FactoryPanel.description',
              'Plan a goal into a task graph, gate every task on your repo’s verify command, and land verified work onto one factory/<run> branch for review.'
            )}
          </p>
        </div>
      </div>
      <FactoryGateSection />
      <FactoryBoardSection />
    </section>
  )
}
