import type { ScoringGeometryKind, Track } from '@/lib/flightlog/types'
import { SCORING_KINDS, formatScoringSummary, scoringLabel, scoringUnavailableReason } from './scoring-overlay'

type ScoringOverlaySelectProps = {
  scoring: Track['scoring']
  selectedKind: ScoringGeometryKind | null
  onSelectKind: (kind: ScoringGeometryKind | null) => void
}

const NONE_VALUE = ''

function toKind(value: string): ScoringGeometryKind | null {
  return SCORING_KINDS.find((kind) => kind === value) ?? null
}

// One select, not checkboxes: showing more than one scoring line on the map at once is
// noise (#15), so only one overlay (or none) is ever active. A native select keeps the control
// on one line so it does not push the map down.
export function ScoringOverlaySelect({ scoring, selectedKind, onSelectKind }: ScoringOverlaySelectProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="form-label">Scoring overlay</span>
        <select
          value={selectedKind ?? NONE_VALUE}
          onChange={(event) => onSelectKind(toKind(event.target.value))}
          className="min-w-0 flex-1 rounded border border-current/30 bg-transparent px-2 py-1"
        >
          <option value={NONE_VALUE} data-testid="scoring-overlay-option">
            None
          </option>
          {SCORING_KINDS.map((kind) => (
            <ScoringOption key={kind} kind={kind} scoring={scoring} />
          ))}
        </select>
      </label>
      {selectedKind && (
        <p className="text-xs tabular-nums text-muted" aria-live="polite" data-testid="scoring-overlay-summary">
          {formatScoringSummary(selectedKind, scoring)}
        </p>
      )}
    </div>
  )
}

// The reason is part of the option text: an <option> cannot hold markup, and a disabled option
// is never focusable, so a hover-only tooltip would leave keyboard and screen-reader users
// with a dimmed entry and no explanation.
function ScoringOption({ kind, scoring }: { kind: ScoringGeometryKind; scoring: Track['scoring'] }) {
  const reason = scoringUnavailableReason(scoring[kind])
  const label = scoringLabel(kind, scoring)
  return (
    <option value={kind} disabled={reason !== null} data-testid="scoring-overlay-option">
      {reason === null ? label : `${label} (${reason})`}
    </option>
  )
}
