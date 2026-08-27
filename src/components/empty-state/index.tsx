import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      <Inbox aria-hidden="true" className="mt-0.5 shrink-0" size={14} />
      <p>{children}</p>
    </div>
  )
}
