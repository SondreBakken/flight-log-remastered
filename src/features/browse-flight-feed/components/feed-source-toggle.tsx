import { classes } from '@/lib/classes'

export type FeedSourceMode = 'pilots' | 'takeoffs' | 'both'

const OPTIONS: ReadonlyArray<{ mode: FeedSourceMode; label: string }> = [
  { mode: 'pilots', label: 'Pilots' },
  { mode: 'takeoffs', label: 'Takeoffs' },
  { mode: 'both', label: 'Both' },
]

export function FeedSourceToggle({ mode, onChange }: { mode: FeedSourceMode; onChange: (next: FeedSourceMode) => void }) {
  return (
    <div role="group" aria-label="Show flights from" className="inline-flex overflow-hidden rounded-md border border-rule text-sm">
      {OPTIONS.map((option, index) => (
        <button
          key={option.mode}
          type="button"
          aria-pressed={mode === option.mode}
          onClick={() => onChange(option.mode)}
          className={classes('px-3 py-1', index > 0 && 'border-l border-rule', mode === option.mode ? 'font-semibold underline' : 'opacity-70')}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
