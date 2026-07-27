import type { Flight, Pilot } from '@/lib/flightlog/types'

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
  trackedTripIds: number[]
}

export type PilotFeedFailure = {
  status: 'error'
  pilotId: number
  message: string
}

export type PilotFeedResult = PilotFeedSuccess | PilotFeedFailure

export type FeedEntry = {
  pilot: Pilot
  flight: Flight
  hasTrack: boolean
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
 * getTrackedTripIds in lib/flightlog/tracks.ts). But the slice alone does NOT bound the
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
 * logbook, then resolves which of the sliced flights have a GPS track via the injected
 * `resolveTrackedTripIds` (in production, getTrackedTripIds — see route.ts). Kept here
 * rather than inline in the route handler, and infra-free (no 'server-only'/'next/cache'
 * import) specifically so it can be unit tested with a stub in check-feed.mts: the years
 * passed to `resolveTrackedTripIds` coming from the SLICE, not the pilot's full history, is
 * exactly the traffic-safety property this function exists to keep correct.
 */
export async function loadRecentFlightsForPilot(
  pilotId: number,
  logbook: { pilot: Pilot; flights: Flight[] },
  resolveTrackedTripIds: (pilotId: number, years: number[]) => Promise<Set<number>>,
  limit: number = RECENT_FLIGHTS_PER_PILOT,
): Promise<{ pilot: Pilot; flights: Flight[]; trackedTripIds: number[] }> {
  const recent = sliceRecentFlights(logbook.flights, limit)
  const trackedTripIds = await resolveTrackedTripIds(pilotId, recent.years)
  return { pilot: logbook.pilot, flights: recent.flights, trackedTripIds: [...trackedTripIds] }
}

function toFeedEntries(result: PilotFeedSuccess): FeedEntry[] {
  const trackedTripIds = new Set(result.trackedTripIds)
  return result.flights.map((flight) => ({
    pilot: result.pilot,
    flight,
    hasTrack: trackedTripIds.has(flight.tripId),
  }))
}

/**
 * Merges every followed pilot's already-sliced flights into one feed: flattens the
 * successful results, sorts newest first across ALL pilots (not per pilot), then slices
 * to the feed size. Failed pilots contribute no entries here — see failedPilotResults,
 * which surfaces them instead of letting them disappear silently.
 */
export function buildFeedEntries(results: PilotFeedResult[], limit: number = FEED_SIZE): FeedEntry[] {
  const entries = results
    .filter((result): result is PilotFeedSuccess => result.status === 'success')
    .flatMap(toFeedEntries)
  entries.sort((a, b) => compareFlightsNewestFirst(a.flight, b.flight))
  return entries.slice(0, limit)
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
