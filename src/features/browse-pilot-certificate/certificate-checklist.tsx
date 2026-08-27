'use client'

import { useState } from 'react'
import { toggleCertificateChecklistItemAction } from './actions'
import type { CertificateLevel, EvaluatedRequirement } from '@/lib/certificates/types'

type CertificateChecklistProps = {
  level: CertificateLevel
  items: EvaluatedRequirement[]
  isOwner: boolean
}

// Experience/tenure items are always read-only, for owner and viewer alike — they're computed
// numbers, nobody edits them directly. Manual items are checkboxes: interactive only for the
// owner (optimistic toggle, reverted on a failed write), disabled and reflecting stored state for
// everyone else — same optimistic-then-reconcile shape as follow-button/index.tsx's own toggle.
export function CertificateChecklist({ level, items, isOwner }: CertificateChecklistProps) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {items.map((item) => (
        <li key={item.id}>
          {item.kind === 'manual' ? (
            <ManualItemRow isOwner={isOwner} item={item} level={level} />
          ) : (
            <ComputedItemRow item={item} />
          )}
        </li>
      ))}
    </ul>
  )
}

function ComputedItemRow({ item }: { item: Extract<EvaluatedRequirement, { kind: 'experience' | 'tenure' }> }) {
  const summary = item.kind === 'experience' ? `${item.current} / ${item.threshold} ${item.unit}` : `${item.daysHeld ?? 0} / ${item.minDays} days`
  const progress = item.kind === 'experience' ? Math.min(item.current / item.threshold, 1) : Math.min((item.daysHeld ?? 0) / item.minDays, 1)
  const caveat = item.kind === 'experience' ? item.caveat : undefined

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="w-56 shrink-0">
          {item.satisfied && <span aria-hidden className="mr-1">✓</span>}
          {item.label}
        </span>
        <span className="h-2 flex-1 overflow-hidden rounded bg-black/5 dark:bg-white/10">
          <span className="block h-full rounded bg-black/40 dark:bg-white/50" style={{ width: `${progress * 100}%` }} />
        </span>
        <span className="w-24 shrink-0 text-right tabular-nums opacity-70">{summary}</span>
      </div>
      {caveat && <p className="text-xs opacity-60">{caveat}</p>}
    </div>
  )
}

function ManualItemRow({
  level,
  item,
  isOwner,
}: {
  level: CertificateLevel
  item: Extract<EvaluatedRequirement, { kind: 'manual' }>
  isOwner: boolean
}) {
  const [checked, setChecked] = useState(item.checked)
  const [error, setError] = useState<string | null>(null)

  function handleChange() {
    const next = !checked
    setChecked(next)
    setError(null)
    toggleCertificateChecklistItemAction(level, item.id, next).then((result) => {
      if (result.status === 'error') {
        setChecked(!next)
        setError(result.message)
      }
    })
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2">
        <input checked={checked} disabled={!isOwner} onChange={handleChange} type="checkbox" />
        {item.label}
      </label>
      {error && (
        <p aria-live="polite" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
