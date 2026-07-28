import type { Flight } from './types'

// Shared by every view that lists flights (pilot logbook, flight feed) so the two never
// drift into showing the same flight differently.
export function formatFlightDistance(flight: Flight): string {
  const distance = flight.distanceKm ?? flight.openDistanceKm
  return distance === null ? '—' : `${distance.toFixed(1)} km`
}

// `duration` on an aggregated row (`flightCount > 1`) is the GROUP TOTAL across those flights,
// never a per-flight duration — flightlog.org publishes no per-flight breakdown for one (#68,
// measured against rqtid=1's independently labelled "Time (hours)" column: pilot 12677's own
// logbook has four rows, two of them aggregated, totalling ten flights across 51 minutes, and
// that sum matches the column exactly, 4x under what treating each row's duration as per-flight
// would give). The old `${duration} (${flightCount})` form read as "N flights of duration each"
// — say what the row actually means instead of leaving the total-vs-per-flight relationship
// unstated.
export function formatFlightDuration(flight: Flight): string {
  if (flight.duration === null) return '—'
  return flight.flightCount > 1
    ? `${flight.duration} total (${flight.flightCount} flights)`
    : flight.duration
}
