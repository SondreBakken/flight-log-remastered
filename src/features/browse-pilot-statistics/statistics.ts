import { flightYear, isCalendarDate } from '@/lib/flightlog/flight-year'
import type { Flight } from '@/lib/flightlog/types'
// Re-exported (not just imported) so this module's existing importers (index.tsx,
// flying-days-calendar.tsx, statistics.test.ts) keep pulling it from here — the shared
// implementation itself now lives in src/lib/text/pluralize.ts, alongside browse-flown-sites-
// map's own use of it (R8: was a verbatim duplicate of this file's copy).
import { pluralize } from '@/lib/text/pluralize'
export { pluralize }

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

// Named for what it returns, not what the component does with it — every caller renamed the
// old `hoursByYear` result to `minutesByYear` before using it, because the value was always
// minutes; formatting to hours is the component's job (see formatMinutesAsHours in index.tsx).
export function minutesByYear(flights: Flight[]): Map<number, number> {
  const totals = new Map<number, number>()
  for (const flight of flights) {
    if (flight.duration === null) continue
    const year = flightYear(flight)
    totals.set(year, (totals.get(year) ?? 0) + parseDurationMinutes(flight.duration))
  }
  return totals
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

// Case-fold + collapse-whitespace only — deliberately narrower than fold-search.ts's
// foldForSearch (which also strips accents and collapses repeated letters for substring
// search). Those extra folds would over-merge distinct glider model names here; this
// breakdown groups spelling variants of the SAME label, not fuzzy-matches different ones.
function normalizeForGrouping(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Groups by a normalized key so spelling variants collapse into one row (real fixture data:
// pilot 4549's "falcon 4" vs "Falcon 4", pilot 12677's "skywalk Mescal 6" vs "Skywalk Mescal
// 6"), but keys the returned map by whichever ORIGINAL spelling occurred most often among
// that group's rows (ties broken by first-seen order) — the label shown is one flightlog.org
// actually rendered, never a synthesized normalized form.
//
// Word order is deliberately left unmerged: pilot 12677's "Mescal skywalk 6" normalizes to a
// different key than "skywalk Mescal 6"/"Skywalk Mescal 6" and stays its own group. Matching
// "the same wing, words reordered" needs semantic knowledge this function doesn't have —
// forcing it here risks merging two actually-different gliders that happen to share words in
// a different order, a worse failure than leaving an obvious near-duplicate split.
function sumFlightCountByNormalizedKey(
  flights: Flight[],
  labelOf: (flight: Flight) => string,
): Map<string, number> {
  const groups = new Map<string, { flightCount: number; variantCounts: Map<string, number> }>()

  for (const flight of flights) {
    const label = labelOf(flight)
    const key = normalizeForGrouping(label)
    const group = groups.get(key) ?? { flightCount: 0, variantCounts: new Map<string, number>() }
    group.flightCount += flight.flightCount
    group.variantCounts.set(label, (group.variantCounts.get(label) ?? 0) + 1)
    groups.set(key, group)
  }

  const totals = new Map<string, number>()
  for (const group of groups.values()) {
    totals.set(mostFrequentVariant(group.variantCounts), group.flightCount)
  }
  return totals
}

// `variantCounts` is in first-seen insertion order (Map's own iteration order for a key set
// via .set()); using strict `>` rather than `>=` means the first variant to reach the current
// best count keeps that spot, which is exactly the "ties: first seen" rule.
function mostFrequentVariant(variantCounts: Map<string, number>): string {
  let best = ''
  let bestCount = -1
  for (const [variant, count] of variantCounts) {
    if (count > bestCount) {
      best = variant
      bestCount = count
    }
  }
  return best
}

// Decision: a null glider is labelled, not filtered out. Filtering would make this
// breakdown's total silently undercount totalFlightCount for a pilot with any unlabelled
// row; labelling keeps the two reconcilable and makes the gap visible instead of hidden.
export function breakdownByGlider(flights: Flight[]): Map<string, number> {
  return sumFlightCountByNormalizedKey(flights, (flight) => flight.glider ?? UNKNOWN_GLIDER)
}

// Same null-labelling decision as breakdownByGlider, applied to `takeoff` — but NOT the same
// case/whitespace normalization. `glider` is free text a pilot typed into a form field, which
// is where the spelling variants above come from; `takeoff` comes from flightlog.org's own
// site register (the same names rqtid=11 publishes), so it is expected to already be
// canonical per pilot. No fixture on hand shows a `takeoff` spelling variant to normalize —
// if one turns up, add the same normalization here and pin it with a test, the same way
// breakdownByGlider's variants are pinned below.
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
    // Excludes placeholder-dated rows (flight-year.ts's isCalendarDate) — crowning one "longest
    // flight" would render its nonsense date, e.g. "2026-00-00 at Vikersund, Antenna".
    if (flight.flightCount !== 1 || flight.duration === null || !isCalendarDate(flight.date)) continue
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

// Unlike longestFlightByDuration, every row is eligible here, including aggregated ones
// (flightCount > 1). Falls back to openDistanceKm exactly as formatFlightDistance does, so the
// two never disagree about which distance a row is "worth".
//
// OPEN ASSUMPTION, not a measured fact like the duration-is-a-group-total claim above: no
// aggregated row carrying a recorded distanceKm/openDistanceKm has been observed in any
// fixture or live pull on hand, so whether flightlog.org's distance field is per-flight or
// (like duration) a group total for such a row is untested, not confirmed either way. This
// would be falsified by finding one real aggregated row (flightCount > 1) with a non-null
// distance and a corresponding per-flight distance recorded elsewhere (e.g. a GPS track) that
// disagrees with treating the row's distance as a single flight's — until then, the all-rows
// behavior stands on absence of a counterexample, not on positive confirmation.
export function longestFlightByDistance(flights: Flight[]): Flight | null {
  let longest: Flight | null = null
  let longestKm = -1
  for (const flight of flights) {
    // Same placeholder-date exclusion as longestFlightByDuration above, so the two cards agree
    // on which rows are eligible to be crowned "longest".
    if (!isCalendarDate(flight.date)) continue
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
    // A placeholder date (flight-year.ts's isCalendarDate) isn't a real calendar day to plot —
    // counting it here would make the "Flying days (N)" heading disagree with the number of
    // shaded cells the calendar below actually renders, since both read this same map.
    if (!isCalendarDate(flight.date)) continue
    flightsByDate.set(flight.date, (flightsByDate.get(flight.date) ?? 0) + flight.flightCount)
  }
  return flightsByDate
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Every calendar day in `year`, Jan 1 through Dec 31 — clipped to `todayIso` for the current
// year so the heatmap never renders a not-yet-happened day as an absent (level 0) flying day,
// which would misread as a gap rather than as "the future." `todayIso` is a plain 'YYYY-MM-DD'
// string rather than a Date so it can cross the server/client component boundary as a plain
// serializable prop and both sides agree on "today" without either calling `new Date()` (#81).
// UTC throughout: `new Date('YYYY-MM-DD')` parses as UTC midnight per the ISO 8601 date-only
// rule, so today and every generated date are compared and stepped as UTC midnights and the
// loop can't skip or repeat a day around a local-timezone DST boundary.
export function datesInYear(year: number, todayIso: string): string[] {
  const today = new Date(todayIso)
  const start = Date.UTC(year, 0, 1)
  const end = Math.min(
    Date.UTC(year, 11, 31),
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  )

  const dates: string[] = []
  for (let day = start; day <= end; day += 24 * 60 * 60 * 1000) {
    dates.push(toIsoDate(new Date(day)))
  }
  return dates
}

// Years with at least one flying day, in no particular order — the calendar's own
// yearsInRange below turns this into the full descending range it must render, INCLUDING
// years with zero flying days in between (a pilot who flew in 2016 and 2014 but not 2015 still
// gets a 2015 row; this set only says which of those years get a real calendar grid vs a
// one-line gap marker).
export function yearsWithFlyingDays(dates: Iterable<string>): Set<number> {
  return new Set([...dates].map((date) => Number(date.slice(0, 4))))
}

// The full descending year range a calendar must account for — every year from the earliest to
// the latest flying day, not just the years that themselves have one. Without this, a calendar
// covering 2014 and 2016 but not 2015 would jump straight from one row to the other with no
// visible sign that 2015 was ever skipped, rather than fallow.
export function yearsInRange(years: Iterable<number>): number[] {
  const values = [...years]
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  return Array.from({ length: max - min + 1 }, (_, index) => max - index)
}

// One year's own accessible summary, read once instead of once per cell — a calendar year
// row's individual day cells are aria-hidden, so this is the only thing a screen reader
// announces for the whole year, and it also doubles as a collapsed year's button label (#81).
export function summarizeCalendarYear(
  dates: string[],
  flightsByDate: ReadonlyMap<string, number>,
): { flyingDays: number; flights: number } {
  let flyingDays = 0
  let flights = 0
  for (const date of dates) {
    const count = flightsByDate.get(date) ?? 0
    if (count > 0) {
      flyingDays += 1
      flights += count
    }
  }
  return { flyingDays, flights }
}

// Same result as summarizeCalendarYear, without ever materializing the year's ~365 date
// strings — a collapsed year only needs its two totals, not a day-by-day walk. Same clip as
// datesInYear, without materializing the dates: every year is toggleable, including the
// current one, so a not-yet-happened date under this prefix must still be excluded here.
// `date > todayIso` works on the plain ISO strings because 'YYYY-MM-DD' sorts the same
// lexicographically as chronologically.
export function summarizeCollapsedYear(
  year: number,
  flightsByDate: ReadonlyMap<string, number>,
  todayIso: string,
): { flyingDays: number; flights: number } {
  const prefix = `${year}-`
  let flyingDays = 0
  let flights = 0
  for (const [date, count] of flightsByDate) {
    if (!date.startsWith(prefix) || date > todayIso) continue
    flyingDays += 1
    flights += count
  }
  return { flyingDays, flights }
}

// Shared by both a year's button label and its expanded grid's aria-label (#81) — kept as one
// function so the two can never drift into two different-looking strings for the same year.
export function calendarYearLabel(year: number, flyingDays: number, flights: number): string {
  return `${year}: ${pluralize(flyingDays, 'flying day')}, ${pluralize(flights, 'flight')}`
}

// The years a calendar defaults to expanded: the `count` most recent years that actually have
// flights, walking `orderedYears` (newest first) and skipping fallow years — a gap year must
// not consume a slot in the budget, or a pilot with a recent multi-year gap would see fewer
// than `count` real years expanded (#81).
export function defaultExpandedCalendarYears(
  orderedYears: number[],
  yearsWithData: ReadonlySet<number>,
  count: number,
): Set<number> {
  const expanded = new Set<number>()
  for (const year of orderedYears) {
    if (expanded.size >= count) break
    if (yearsWithData.has(year)) expanded.add(year)
  }
  return expanded
}
