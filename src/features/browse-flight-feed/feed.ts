import type { Flight, Pilot } from '@/lib/flightlog/types'

// Each pilot's own recent slice must be at least as large as the merged feed: in the
// worst case one followed pilot supplies every entry, and slicing a pilot's history
// smaller than FEED_SIZE would silently drop flights that belonged in the final feed
// before the cross-pilot merge ever saw them.
export const FEED_SIZE = 30
export const RECENT_FLIGHTS_PER_PILOT = FEED_SIZE

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
 * years that slice touches — from the SLICE, never from the untrimmed history passed in.
 *
 * This pairing is the traffic-safety property recorded in docs/flightlog-api.md:
 * resolving GPS tracks costs one request per pilot per year (see getTrackedTripIds in
 * lib/flightlog/tracks.ts). A pilot with an 18-year history would cost 18 of those
 * requests per feed load if years were derived from the full history instead of the
 * slice actually shown; deriving them from `recent` here is what collapses that back
 * down to the one or two years a recent feed actually spans.
 */
export function sliceRecentFlights(
  flights: Flight[],
  limit: number = RECENT_FLIGHTS_PER_PILOT,
): RecentFlightsSlice {
  const recent = sortFlightsNewestFirst(flights).slice(0, limit)
  return { flights: recent, years: [...new Set(recent.map(yearOf))] }
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
