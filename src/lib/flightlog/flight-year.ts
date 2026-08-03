import type { Flight } from './types'

// `date` is always 'YYYY-MM-DD' (see parse-flights.ts's readDate) — the year is its own first
// four characters, no Date parsing needed. Shared by every caller that groups or filters
// flights by calendar year (pilot statistics, the pilot page's own track-year lookup) so the
// same slice of the date string isn't repeated at each call site.
export function flightYear(flight: Flight): number {
  return Number(flight.date.slice(0, 4))
}

// flightlog.org sometimes leaves a flight's day (and month) unrecorded and emits a placeholder
// like '2026-00-00' in their place — real fixture shape (pilot 4549's trips 987253, 966728),
// distinct from parse-club-detail.ts's own '0000-00-00 00:00:00' placeholder (a different field,
// a different endpoint). readDate's `\d{4}-\d{2}-\d{2}` regex accepts these unchanged, on
// purpose: this file's job is answering "is this date a real calendar day", not deciding which
// rows the parser keeps.
//
// Decision, not an oversight: a placeholder date is still a real FLIGHT (totalFlightCount,
// totalDurationMinutes) and still belongs to a real YEAR (minutesByYear — flightYear above reads
// the same year digits either way), so neither of those filters on this. But it is not a real
// CALENDAR DAY, so flying-day counting and the longest-flight cards (statistics.ts's
// flyingDaysByDate, longestFlightByDuration, longestFlightByDistance) all exclude it — otherwise
// a row like this would either inflate the flying-days count with a day that never happened, or
// get crowned "longest flight" showing a nonsense date like "2026-00-00 at Vikersund, Antenna".
export function isCalendarDate(date: string): boolean {
  const [, month, day] = date.split('-')
  return month !== '00' && day !== '00'
}
