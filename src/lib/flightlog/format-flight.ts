import type { Flight } from './types'

// Shared by every view that lists flights (pilot logbook, flight feed) so the two never
// drift into showing the same flight differently.
export function formatFlightDistance(flight: Flight): string {
  const distance = flight.distanceKm ?? flight.openDistanceKm
  return distance === null ? '—' : `${distance.toFixed(1)} km`
}

export function formatFlightDuration(flight: Flight): string {
  if (flight.duration === null) return '—'
  return flight.flightCount > 1 ? `${flight.duration} (${flight.flightCount})` : flight.duration
}
