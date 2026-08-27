import { isCalendarDate } from './flight-year'
import type { Flight } from './types'

// A row's `duration` is 'H:MM' or 'HH:MM' (see parse-flights.ts's readDuration) — hours is
// 1-2 digits, minutes always 2. Never fed an aggregated row's group total here as if it were
// per-flight; callers decide which rows are eligible before parsing.
export function parseDurationMinutes(duration: string): number {
  const [hours, minutes] = duration.split(':').map(Number)
  return hours * 60 + minutes
}

// Row duration is already the GROUP TOTAL across `flightCount` flights — summed as-is, never
// divided or multiplied by flightCount, which would fabricate a per-flight number the source
// never published.
export function totalDurationMinutes(flights: Flight[]): number {
  return flights.reduce(
    (total, flight) => (flight.duration === null ? total : total + parseDurationMinutes(flight.duration)),
    0,
  )
}

const UNKNOWN_TAKEOFF = 'Unknown takeoff'

// Sums flightCount per key, never row count — a site flown across several aggregated rows must
// report the flights, not the rows.
export function breakdownBySite(flights: Flight[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const flight of flights) {
    const key = flight.takeoff ?? UNKNOWN_TAKEOFF
    totals.set(key, (totals.get(key) ?? 0) + flight.flightCount)
  }
  return totals
}

// Heatmap input: date → flights that day (summed flightCount, not row count).
export function flyingDaysByDate(flights: Flight[]): Map<string, number> {
  const flightsByDate = new Map<string, number>()
  for (const flight of flights) {
    // A placeholder date (flight-year.ts's isCalendarDate) isn't a real calendar day to plot.
    if (!isCalendarDate(flight.date)) continue
    flightsByDate.set(flight.date, (flightsByDate.get(flight.date) ?? 0) + flight.flightCount)
  }
  return flightsByDate
}

// Falls back to openDistanceKm when distanceKm is absent, so every caller agrees on which
// distance a row is "worth" instead of each re-deriving the fallback differently.
export function flightDistanceKm(flight: Flight): number | null {
  return flight.distanceKm ?? flight.openDistanceKm
}
