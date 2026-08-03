import type { Flight } from '@/lib/flightlog/types'
import { totalFlightCount } from '@/lib/flightlog/flight-count'

// Re-exported (not duplicated) so this feature's derivations and browse-pilot-logbook's
// header both read the same total-flights implementation — see flight-count.ts's own doc
// comment for why the two must never drift.
export { totalFlightCount }

// A row's `duration` is 'H:MM' or 'HH:MM' (see parse-flights.ts's readDuration) — hours is
// 1-2 digits, minutes always 2. Never fed an aggregated row's group total here as if it were
// per-flight; callers below decide which rows are eligible before parsing.
export function parseDurationMinutes(duration: string): number {
  const [hours, minutes] = duration.split(':').map(Number)
  return hours * 60 + minutes
}

// Row duration is already the GROUP TOTAL across `flightCount` flights (#68) — summed as-is,
// never divided or multiplied by flightCount, which would fabricate a per-flight number the
// source never published.
export function totalDurationMinutes(flights: Flight[]): number {
  return flights.reduce(
    (total, flight) => (flight.duration === null ? total : total + parseDurationMinutes(flight.duration)),
    0,
  )
}

function yearOf(flight: Flight): number {
  return Number(flight.date.slice(0, 4))
}

export function hoursByYear(flights: Flight[]): Map<number, number> {
  const minutesByYear = new Map<number, number>()
  for (const flight of flights) {
    if (flight.duration === null) continue
    const year = yearOf(flight)
    minutesByYear.set(year, (minutesByYear.get(year) ?? 0) + parseDurationMinutes(flight.duration))
  }
  return minutesByYear
}

const UNKNOWN_GLIDER = 'Unknown glider'
const UNKNOWN_TAKEOFF = 'Unknown takeoff'

// Sums flightCount per key, never row count — a glider/site flown across several aggregated
// rows must report the flights, not the rows, same reasoning as totalFlightCount.
function sumFlightCountByKey(flights: Flight[], keyOf: (flight: Flight) => string): Map<string, number> {
  const totals = new Map<string, number>()
  for (const flight of flights) {
    const key = keyOf(flight)
    totals.set(key, (totals.get(key) ?? 0) + flight.flightCount)
  }
  return totals
}

// Decision: a null glider is labelled, not filtered out. Filtering would make this
// breakdown's total silently undercount totalFlightCount for a pilot with any unlabelled
// row; labelling keeps the two reconcilable and makes the gap visible instead of hidden.
export function breakdownByGlider(flights: Flight[]): Map<string, number> {
  return sumFlightCountByKey(flights, (flight) => flight.glider ?? UNKNOWN_GLIDER)
}

// Same decision as breakdownByGlider, applied to `takeoff`.
export function breakdownBySite(flights: Flight[]): Map<string, number> {
  return sumFlightCountByKey(flights, (flight) => flight.takeoff ?? UNKNOWN_TAKEOFF)
}

// Restricted to flightCount === 1 rows: an aggregated row's duration is a GROUP TOTAL across
// several flights (#68), not one flight's duration, so crowning it "longest flight" would
// fabricate a record the source never published — same reasoning format-flight.ts's
// formatFlightDuration uses to avoid rendering it as a bare per-flight time. This is a
// recorded decision on #16, not an oversight.
export function longestFlightByDuration(flights: Flight[]): Flight | null {
  let longest: Flight | null = null
  let longestMinutes = -1
  for (const flight of flights) {
    if (flight.flightCount !== 1 || flight.duration === null) continue
    const minutes = parseDurationMinutes(flight.duration)
    if (minutes > longestMinutes) {
      longest = flight
      longestMinutes = minutes
    }
  }
  return longest
}

function distanceOf(flight: Flight): number | null {
  return flight.distanceKm ?? flight.openDistanceKm
}

// Unlike longestFlightByDuration, every row is eligible — a row's distance is the flight's
// own distance regardless of flightCount, never a group total (#68 is a duration-only trap).
// Falls back to openDistanceKm exactly as formatFlightDistance does, so the two never
// disagree about which distance a row is "worth".
export function longestFlightByDistance(flights: Flight[]): Flight | null {
  let longest: Flight | null = null
  let longestKm = -1
  for (const flight of flights) {
    const distance = distanceOf(flight)
    if (distance === null) continue
    if (distance > longestKm) {
      longest = flight
      longestKm = distance
    }
  }
  return longest
}

// Heatmap input: date → flights that day (summed flightCount, not row count), since two rows
// can share a date and one row can itself be several flights. `.size` on the result is the
// flying-day total — a distinct number from totalFlightCount by construction whenever any
// day holds more than one row or an aggregated row.
export function flyingDaysByDate(flights: Flight[]): Map<string, number> {
  const flightsByDate = new Map<string, number>()
  for (const flight of flights) {
    flightsByDate.set(flight.date, (flightsByDate.get(flight.date) ?? 0) + flight.flightCount)
  }
  return flightsByDate
}
