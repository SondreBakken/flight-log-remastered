import type { Flight } from './types'

// `date` is always 'YYYY-MM-DD' (see parse-flights.ts's readDate) — the year is its own first
// four characters, no Date parsing needed. Shared by every caller that groups or filters
// flights by calendar year (pilot statistics, the pilot page's own track-year lookup) so the
// same slice of the date string isn't repeated at each call site.
export function flightYear(flight: Flight): number {
  return Number(flight.date.slice(0, 4))
}
