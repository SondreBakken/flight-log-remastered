import { flightYear, isCalendarDate } from '@/lib/flightlog/flight-year'
import type { Flight } from '@/lib/flightlog/types'

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
