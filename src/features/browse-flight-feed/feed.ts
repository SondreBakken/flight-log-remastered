import type { Flight, Pilot, TrackIndexEntry } from '@/lib/flightlog/types'

// Each pilot's own recent slice must be at least as large as the merged feed: in the
// worst case one followed pilot supplies every entry, and slicing a pilot's history
// smaller than FEED_SIZE would silently drop flights that belonged in the final feed
// before the cross-pilot merge ever saw them.
export const FEED_SIZE = 30
export const RECENT_FLIGHTS_PER_PILOT = FEED_SIZE

// The traffic bound sliceRecentFlights's doc comment below promises: however many distinct
// years a pilot's RECENT_FLIGHTS_PER_PILOT slice actually touches (which for an inactive
// pilot can be far more than "one or two" — a pilot flying once a year spans as many years
// as the slice is deep), only the MOST RECENT this-many years are ever resolved for a GPS
// track. Flights whose year falls outside that window still render, just without a track
// link — a visible, honest degradation for an inactive pilot, not a silent one.
export const MAX_YEARS_PER_PILOT = 2

// Bounds how many followed pilots one feed load fetches at all, independent of the
// per-pilot year cap above: however tight the per-pilot request cost is, a follow list of
// unbounded size must not be allowed to fan out unboundedly. See selectFeedPilotIds.
export const MAX_PILOTS_PER_FEED = 20

export type PilotFeedSuccess = {
  status: 'success'
  pilotId: number
  pilot: Pilot
  flights: Flight[]
  trackedTrips: TrackIndexEntry[]
}

export type PilotFeedFailure = {
  status: 'error'
  pilotId: number
  message: string
}

export type PilotFeedResult = PilotFeedSuccess | PilotFeedFailure

// A flight's "new since last visit" status is one of three states, never collapsed to two:
//   - 'new': tracked, and its ts is newer than the pilot's watermark at the start of this load.
//   - 'not-new': tracked, and its ts is at or before the watermark.
//   - 'unknown': untracked — flightlog.org's rqtid=21 has no row, and therefore no timestamp,
//     for a flight with no uploaded GPS track (confirmed live: a pilot with real flights and
//     zero uploaded tracks gets a 200 with an empty data_items array). "We cannot tell" and
//     "this is not new" are different claims — collapsing this into 'not-new' would render an
//     unchecked flight as confidently checked, which this repo has shipped five times already
//     for a structurally identical reason (#25, #6, #32, #8, #59). See classifyNewness.
export type FlightNewness = 'new' | 'not-new' | 'unknown'

export type FeedEntry = {
  pilot: Pilot
  flight: Flight
  hasTrack: boolean
  newness: FlightNewness
}

export type RecentFlightsSlice = {
  flights: Flight[]
  years: number[]
}

function compareFlightsNewestFirst(a: Flight, b: Flight): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  // Same-day ties: an arbitrary but STABLE tiebreak (higher tripId first), needed
  // because two same-day flights would otherwise order however the source HTML happened
  // to list them, and that order is not something callers here control.
  return b.tripId - a.tripId
}

function sortFlightsNewestFirst(flights: Flight[]): Flight[] {
  return [...flights].sort(compareFlightsNewestFirst)
}

function yearOf(flight: Flight): number {
  return Number(flight.date.slice(0, 4))
}

/**
 * Slices a pilot's full history down to their most recent flights, AND derives which
 * years that slice touches — from the SLICE, never from the untrimmed history passed in,
 * and capped to the MAX_YEARS_PER_PILOT most recent of those years.
 *
 * The slice-not-history half is the traffic-safety property recorded in
 * docs/flightlog-api.md: resolving GPS tracks costs one request per pilot per year (see
 * getTrackedTripEntries in lib/flightlog/tracks.ts). But the slice alone does NOT bound the
 * year count: an infrequent pilot's RECENT_FLIGHTS_PER_PILOT most recent flights can still
 * span as many distinct years as the slice is deep (one flight a year for 30 years slices
 * to 30 years, not "one or two"). The explicit MAX_YEARS_PER_PILOT cap below is what
 * actually bounds it — flights outside the kept years still render, just without a track
 * link (see MAX_YEARS_PER_PILOT's doc comment).
 */
export function sliceRecentFlights(
  flights: Flight[],
  limit: number = RECENT_FLIGHTS_PER_PILOT,
): RecentFlightsSlice {
  const recent = sortFlightsNewestFirst(flights).slice(0, limit)
  const years = [...new Set(recent.map(yearOf))]
    .sort((a, b) => b - a)
    .slice(0, MAX_YEARS_PER_PILOT)
  return { flights: recent, years }
}

/**
 * Orchestrates one pilot's slice of the route's response: slices the already-fetched
 * logbook, then resolves which of the sliced flights have a GPS track (and each one's `ts`)
 * via the injected `resolveTrackedTrips` (in production, getTrackedTripEntries — see
 * route.ts). Kept here rather than inline in the route handler, and infra-free (no
 * 'server-only'/'next/cache' import) specifically so it can be unit tested with a stub in
 * check-feed.mts: the years passed to `resolveTrackedTrips` coming from the SLICE, not the
 * pilot's full history, is exactly the traffic-safety property this function exists to
 * keep correct.
 */
export async function loadRecentFlightsForPilot(
  pilotId: number,
  logbook: { pilot: Pilot; flights: Flight[] },
  resolveTrackedTrips: (pilotId: number, years: number[]) => Promise<TrackIndexEntry[]>,
  limit: number = RECENT_FLIGHTS_PER_PILOT,
): Promise<{ pilot: Pilot; flights: Flight[]; trackedTrips: TrackIndexEntry[] }> {
  const recent = sliceRecentFlights(logbook.flights, limit)
  const trackedTrips = await resolveTrackedTrips(pilotId, recent.years)
  return { pilot: logbook.pilot, flights: recent.flights, trackedTrips }
}

// The newest `ts` among a pilot's own tracked trips fetched this load, or null if none were
// tracked. This is the candidate a caller (see use-flight-feed.ts) advances that pilot's
// stored watermark to, via watermark-store's advanceWatermark — never computed against the
// CURRENT watermark here, since "is this an improvement" is watermark-store's own job (it
// already guards against ever moving backward), not something feed.ts, which knows nothing
// about localStorage, should duplicate.
export function maxTrackedTs(trackedTrips: readonly TrackIndexEntry[]): string | null {
  return trackedTrips.reduce<string | null>(
    (max, entry) => (max === null || entry.updatedAt > max ? entry.updatedAt : max),
    null,
  )
}

// Strictly greater-than, not greater-or-equal — measured live against flightlog.org: passing
// exactly a flight's own `ts` as the watermark still returns that flight, so `>=` here would
// mark it "not new" the very next visit only by luck of exact equality, and reusing max(ts)
// as the watermark verbatim (see maxTrackedTs) would then re-mark THAT SAME flight new forever
// via the inverse mistake. `watermarkAtLoad === null` (this pilot has never been seen before)
// means everything trackable is new, not nothing — the honest reading of "no watermark yet".
function classifyNewness(trackedAt: string | null, watermarkAtLoad: string | null): FlightNewness {
  if (trackedAt === null) return 'unknown'
  if (watermarkAtLoad === null) return 'new'
  return trackedAt > watermarkAtLoad ? 'new' : 'not-new'
}

function toFeedEntries(result: PilotFeedSuccess, watermarksAtLoad: ReadonlyMap<number, string | null>): FeedEntry[] {
  const trackedAtByTripId = new Map(result.trackedTrips.map((entry) => [entry.tripId, entry.updatedAt]))
  const watermarkAtLoad = watermarksAtLoad.get(result.pilotId) ?? null
  return result.flights.map((flight) => {
    const trackedAt = trackedAtByTripId.get(flight.tripId) ?? null
    return {
      pilot: result.pilot,
      flight,
      hasTrack: trackedAt !== null,
      newness: classifyNewness(trackedAt, watermarkAtLoad),
    }
  })
}

/**
 * Merges every followed pilot's already-sliced flights into one feed: flattens the
 * successful results, sorts newest first across ALL pilots (not per pilot), then slices
 * to the feed size. Failed pilots contribute no entries here — see failedPilotResults,
 * which surfaces them instead of letting them disappear silently.
 *
 * `watermarksAtLoad` is each pilot's watermark AS READ AT THE START of this load, before any
 * of them advance (see use-flight-feed.ts) — classifying against a watermark that had already
 * moved would make "new" disappear the instant it was computed. Defaults to an empty map so
 * every existing caller not concerned with newness (e.g. check-feed.mts's merge/sort/slice
 * assertions) keeps working unchanged; an empty map simply means every tracked flight reads as
 * 'new' and every untracked one as 'unknown', which no such caller asserts on.
 */
export function buildFeedEntries(
  results: PilotFeedResult[],
  limit: number = FEED_SIZE,
  watermarksAtLoad: ReadonlyMap<number, string | null> = new Map(),
): FeedEntry[] {
  const entries = results
    .filter((result): result is PilotFeedSuccess => result.status === 'success')
    .flatMap((result) => toFeedEntries(result, watermarksAtLoad))
  entries.sort((a, b) => compareFlightsNewestFirst(a.flight, b.flight))
  return entries.slice(0, limit)
}

// The count the UI surfaces (see index.tsx) — among the flights actually shown, not among
// every flight fetched, since only shown flights are what "you've now seen this" can honestly
// mean. Counts 'new' only: 'unknown' (untracked) flights are neither new nor not-new, and must
// not inflate this number one way or the other — see FlightNewness's doc comment.
export function countNewEntries(entries: readonly FeedEntry[]): number {
  return entries.filter((entry) => entry.newness === 'new').length
}

export function failedPilotResults(results: PilotFeedResult[]): PilotFeedFailure[] {
  return results.filter((result): result is PilotFeedFailure => result.status === 'error')
}

export type FeedPilotSelection = {
  pilotIds: number[]
  // The full followed count when truncation happened, so callers can show an honest notice
  // ("following 50, showing 20") instead of truncating silently — null means every followed
  // pilot is included.
  followedCount: number | null
}

/**
 * Bounds how many followed pilots one feed load fetches (MAX_PILOTS_PER_FEED), so a large
 * follow list cannot fan out into an unbounded number of per-pilot requests. Selection is
 * by ascending pilot id — arbitrary but deterministic, so the same pilots show on every
 * load rather than a different random subset each time.
 */
export function selectFeedPilotIds(
  followedIds: Iterable<number>,
  limit: number = MAX_PILOTS_PER_FEED,
): FeedPilotSelection {
  const sorted = [...followedIds].sort((a, b) => a - b)
  return {
    pilotIds: sorted.slice(0, limit),
    followedCount: sorted.length > limit ? sorted.length : null,
  }
}
