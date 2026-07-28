import { SCORING_KIND_LABELS, SCORING_KINDS } from '@/lib/flightlog/types'
import type { ScoringGeometry, ScoringGeometryKind, ScoringGeometryResult, Track } from '@/lib/flightlog/types'

export { SCORING_KINDS }

// True only for a real, parsed geometry — narrows away both `null` ("confirmed absent") and
// `'unparseable'` ("scoring markup this parser doesn't recognise"), the two states nothing
// downstream should ever treat as something with its own name/distance/turnpoints to show.
export function isScoringGeometry(state: ScoringGeometryResult): state is ScoringGeometry {
  return state !== null && state !== 'unparseable'
}

export function scoringLabel(kind: ScoringGeometryKind, scoring: Track['scoring']): string {
  const state = scoring[kind]
  return isScoringGeometry(state) ? state.name : SCORING_KIND_LABELS[kind]
}

// The single reason a disabled overlay option is disabled, worded for both the option's
// tooltip and its inline text (see ScoringOverlaySelect) — one phrasing kept in one place
// rather than drifting into two, the way "— not available" and "— not available for this
// flight" used to.
export function scoringUnavailableReason(state: ScoringGeometryResult): string | null {
  if (isScoringGeometry(state)) return null
  return state === 'unparseable' ? 'could not be read' : 'not available'
}

// Showing every available overlay (or even all five) at once is noise (#15). Defaulting to
// `distance_open` rather than "none" gives a visitor something on first paint, and it's the
// safest anchor because its distance is the one that already matches what the flight list
// elsewhere on the site shows for the same flight (see formatScoringSummary's own doc comment
// on why the OTHER four overlays' distances do not make that same promise). Falls back to no
// selection when even open distance isn't available for this flight (confirmed absent, or
// unparseable) rather than defaulting to a kind this flight doesn't have a real geometry for.
export function resolveDefaultScoringKind(scoring: Track['scoring']): ScoringGeometryKind | null {
  return isScoringGeometry(scoring.distance_open) ? 'distance_open' : null
}

// The geometry actually selected for rendering, or `null` for both "nothing selected" and
// "the selection resolves to something that isn't a real geometry" — TrackMap only ever needs
// to know whether it has a line to draw, not which of the three non-drawable states caused it
// not to.
export function selectedScoringGeometry(
  scoring: Track['scoring'],
  selectedKind: ScoringGeometryKind | null,
): ScoringGeometry | null {
  if (!selectedKind) return null
  const state = scoring[selectedKind]
  return isScoringGeometry(state) ? state : null
}

// A-E, matching the KML's own turnpoint table lettering (Pos. column) exactly, so a turnpoint
// marked "C" on the map is the same "C" a user cross-references against flightlog.org itself.
export function turnpointLetter(index: number): string {
  return String.fromCharCode(65 + index)
}

// Labelled as the geometry's OWN scored distance ("5 points: 52.76 km"), never as "the
// flight's distance": measured against real fixtures, this overlay's own sum can disagree
// with the number flight-list pages already show for the same flight by 1-1.5% on XC flights
// and far more on short ones, because upstream doesn't always surface the largest available
// sum. Presenting it as anything but its own number would silently promise an agreement the
// data doesn't have.
export function formatScoringSummary(kind: ScoringGeometryKind, scoring: Track['scoring']): string {
  const state = scoring[kind]
  if (isScoringGeometry(state)) return `${state.name}: ${state.distanceKm.toFixed(2)} km`
  return `${scoringLabel(kind, scoring)}: ${scoringUnavailableReason(state)}`
}
