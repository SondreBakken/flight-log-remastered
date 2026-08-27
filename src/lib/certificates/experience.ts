import { breakdownBySite, flightDistanceKm, flyingDaysByDate, parseDurationMinutes, totalDurationMinutes } from '@/lib/flightlog/flight-aggregates'
import type { Flight } from '@/lib/flightlog/types'

// flightlog.org has no XC flag and no way to check "multiple lift sources" or "safe out-landing"
// (spec's Requirements definition section) — this is an explicit approximation, always labelled
// as such wherever it's rendered, never presented as a verified XC count.
export const XC_LIKE_DISTANCE_THRESHOLD_KM = 10

export function distinctSiteCount(flights: Flight[]): number {
  return breakdownBySite(flights).size
}

// Restricted to flightCount === 1 rows: an aggregated row's duration is a group total across
// several flights, not one flight's, so counting it toward a single-flight threshold would
// fabricate a number the source never published (same reasoning as
// flight-aggregates.ts's own longestFlightByDuration precedent in statistics.ts).
export function singleFlightsOverMinutes(flights: Flight[], minutes: number): number {
  return flights.filter(
    (flight) => flight.flightCount === 1 && flight.duration !== null && parseDurationMinutes(flight.duration) > minutes,
  ).length
}

export function xcLikeFlightCount(flights: Flight[]): number {
  return flights.filter((flight) => {
    const distance = flightDistanceKm(flight)
    return distance !== null && distance > XC_LIKE_DISTANCE_THRESHOLD_KM
  }).length
}

export function totalHours(flights: Flight[]): number {
  return totalDurationMinutes(flights) / 60
}

export function flyingDayCount(flights: Flight[]): number {
  return flyingDaysByDate(flights).size
}
