import type { ScoringGeometryKind, Track } from '@/lib/flightlog/types'
import { SCORING_KINDS, formatScoringSummary, scoringLabel, scoringUnavailableReason } from './scoring-overlay'

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
          reason={null}
          selected={selectedKind === null}
          onSelect={() => onSelectKind(null)}
        />
        {SCORING_KINDS.map((kind) => (
          <ScoringOption
            key={kind}
            label={scoringLabel(kind, scoring)}
            reason={scoringUnavailableReason(scoring[kind])}
            selected={selectedKind === kind}
            onSelect={() => onSelectKind(kind)}
          />
        ))}
      </div>
      {selectedKind && (
        <p className="text-xs tabular-nums opacity-70" aria-live="polite" data-testid="scoring-overlay-summary">
          {formatScoringSummary(selectedKind, scoring)}
        </p>
      )}
    </fieldset>
  )
}

function ScoringOption({
  label,
  reason,
  selected,
  onSelect,
}: {
  label: string
  // null when this option is selectable; the reason it isn't otherwise (see
  // scoringUnavailableReason). Rendered as visible text, not just a `title` tooltip: a
  // `disabled` radio is never keyboard-focusable, so a hover-only tooltip would leave
  // keyboard and screen-reader users with nothing but a dimmed label and no explanation.
  reason: string | null
  selected: boolean
  onSelect: () => void
}) {
  const disabled = reason !== null
  return (
    <label
      className={`flex items-center gap-1.5 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
      data-testid="scoring-overlay-option"
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
      {reason && <span className="ml-1 text-[10px]">({reason})</span>}
    </label>
  )
}
