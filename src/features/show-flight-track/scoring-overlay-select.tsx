import type { ScoringGeometryKind, Track } from '@/lib/flightlog/types'
import { SCORING_KINDS, formatScoringSummary, scoringLabel } from './scoring-overlay'

type ScoringOverlaySelectProps = {
  scoring: Track['scoring']
  selectedKind: ScoringGeometryKind | null
  onSelectKind: (kind: ScoringGeometryKind | null) => void
}

// A radio group, not checkboxes: showing more than one scoring line on the map at once is
// noise (#15), so only one overlay (or none) is ever active.
export function ScoringOverlaySelect({ scoring, selectedKind, onSelectKind }: ScoringOverlaySelectProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-xs font-medium uppercase tracking-wide opacity-60">Scoring overlay</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <ScoringOption
          label="None"
          selected={selectedKind === null}
          disabled={false}
          onSelect={() => onSelectKind(null)}
        />
        {SCORING_KINDS.map((kind) => (
          <ScoringOption
            key={kind}
            label={scoringLabel(kind, scoring)}
            selected={selectedKind === kind}
            disabled={scoring[kind] === null}
            onSelect={() => onSelectKind(kind)}
          />
        ))}
      </div>
      {selectedKind && (
        <p className="text-xs tabular-nums opacity-70">{formatScoringSummary(selectedKind, scoring)}</p>
      )}
    </fieldset>
  )
}

function ScoringOption({
  label,
  selected,
  disabled,
  onSelect,
}: {
  label: string
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <label
      className={`flex items-center gap-1.5 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
      title={disabled ? `${label} — not available for this flight` : undefined}
    >
      <input
        type="radio"
        name="scoring-overlay"
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        className="accent-amber-500"
      />
      {label}
    </label>
  )
}
