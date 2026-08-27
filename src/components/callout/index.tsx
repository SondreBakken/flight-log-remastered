import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

type CalloutTone = 'warning' | 'error'

type CalloutProps = {
  tone: CalloutTone
  children: ReactNode
}

// Two existing box shapes this generalizes, kept verbatim per tone rather than merged into one:
// the warning boxes (e.g. flight-feed-view.tsx's FailedPilotsNotice) are `p-4 text-sm` with plain
// block-flow children; error.tsx's box is `p-6` with a `flex-col gap-3` stack of heading/message/
// button. TONE_CONTENT_CLASSES preserves each tone's original internal layout inside a nested div,
// while the outer div adds the horizontal `flex items-start gap-3` needed to place the icon beside
// that content without disturbing either tone's original stacking.
const TONE_BOX_CLASSES: Record<CalloutTone, string> = {
  warning: 'flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm',
  error: 'flex items-start gap-3 rounded-md border border-red-500/30 bg-red-500/5 p-6',
}

const TONE_CONTENT_CLASSES: Record<CalloutTone, string> = {
  warning: 'flex-1',
  error: 'flex flex-1 flex-col items-start gap-3',
}

export function Callout({ tone, children }: CalloutProps) {
  return (
    <div className={TONE_BOX_CLASSES[tone]}>
      <TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0 opacity-70" size={14} />
      <div className={TONE_CONTENT_CLASSES[tone]}>{children}</div>
    </div>
  )
}
