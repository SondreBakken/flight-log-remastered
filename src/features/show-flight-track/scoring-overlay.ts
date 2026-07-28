import type { ScoringGeometryKind, Track } from '@/lib/flightlog/types'

// Display order for the overlay selector: the order flightlog.org's own KML lists the
// geometries in (see every fixtures/track-*.kml), not alphabetical or by distance.
export const SCORING_KINDS: ScoringGeometryKind[] = [
  'distance_5_point',
  'distance_4_point',
  'distance_3_point',
  'distance_open',
  'distance_out_and_return',
]

// The KML's own English `<name>` values, verbatim (measured against every sampled fixture —
// see AGENTS.md's naming note). Used as a fallback label for a geometry this flight doesn't
// have (Track.scoring[kind] is null): the selector still needs something to show next to
// "not available", and it's the same string the KML would have used had the placemark been
// present, not an invented label.
const SCORING_LABELS: Record<ScoringGeometryKind, string> = {
  distance_5_point: 'Distance over 5 points',
  distance_4_point: 'Distance over 4 points',
  distance_3_point: 'Distance over 3 points',
  distance_open: 'Open distance',
  distance_out_and_return: 'Out-and-return distance',
}

export function scoringLabel(kind: ScoringGeometryKind, scoring: Track['scoring']): string {
  return scoring[kind]?.name ?? SCORING_LABELS[kind]
}

// Showing every available overlay (or even all five) at once is noise (#15). Defaulting to
// `distance_open` rather than "none" gives a visitor something on first paint, and it's the
// safest anchor because its distance is the one that already matches what the flight list
// elsewhere on the site shows for the same flight (see formatScoringDistance's own doc
// comment on why the OTHER four overlays' distances do not make that same promise). Falls
// back to no selection when even open distance isn't available for this flight (e.g. a
// stub or degenerate KML), rather than defaulting to a kind this flight doesn't have one of.
export function resolveDefaultScoringKind(scoring: Track['scoring']): ScoringGeometryKind | null {
  return scoring.distance_open ? 'distance_open' : null
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
// sum (see AGENTS.md's measured-facts note). Presenting it as anything but its own number
// would silently promise an agreement the data doesn't have.
export function formatScoringSummary(kind: ScoringGeometryKind, scoring: Track['scoring']): string {
  const geometry = scoring[kind]
  if (!geometry) return `${scoringLabel(kind, scoring)} — not available`
  return `${geometry.name}: ${geometry.distanceKm.toFixed(2)} km`
}
