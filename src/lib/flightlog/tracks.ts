import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parseTrack } from './parse-track'
import { runWithConcurrencyLimit } from '@/lib/concurrency/with-limit'
import type { Track, TrackIndexEntry } from './types'

const TRACK_INDEX_BY_PILOT = 21
const TRACK_INDEX_BY_TRIP = 22
const TRACK_KML = 19

// getTrackedTripIds fans out to one request per year, and its caller-supplied `years` is
// not itself bounded everywhere it's called from — the recent-flights feed caps it at
// MAX_YEARS_PER_PILOT, but a pilot's own logbook page (pilots/[userId]/page.tsx) still
// passes every year that pilot has ever flown. Bounding the fan-out here, not just at the
// feed's caller, is what keeps a many-year pilot's own logbook page from bursting
// flightlog.org regardless of which caller reaches this function.
const YEAR_FETCH_CONCURRENCY = 4

type TrackIndexResponse = {
  data_item_count: number
  data_items: Array<[number, string]>
}

function isTrackIndexResponse(value: unknown): value is TrackIndexResponse {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.data_item_count === 'number' && Array.isArray(candidate.data_items)
}

function toIndexEntries(payload: unknown): TrackIndexEntry[] {
  if (!isTrackIndexResponse(payload)) return []
  return payload.data_items.map(([tripId, updatedAt]) => ({ tripId, updatedAt }))
}

async function fetchTrackIndex(query: string): Promise<TrackIndexEntry[]> {
  const body = await fetchFlightlogText(`/fl.html?${query}`, { referer: FLIGHTLOG_ORIGIN })
  return toIndexEntries(JSON.parse(body))
}

export async function getTracksForPilot(
  userId: number,
  year: number,
): Promise<TrackIndexEntry[]> {
  'use cache'
  cacheLife('hours')
  cacheTag(`pilot-${userId}`)

  return fetchTrackIndex(`rqtid=${TRACK_INDEX_BY_PILOT}&user_id=${userId}&year=${year}&ts=0`)
}

// Asking per trip would mean one request per row; the per-year index answers the same
// question for a whole logbook in one request, which matters on a volunteer-run server.
//
// Returns the full TrackIndexEntry (tripId AND updatedAt), not just tripIds: the
// recent-flights feed (see browse-flight-feed/feed.ts) needs each entry's `ts` to tell a
// newly-updated track apart from one already seen (issue #5) — a distinction getTrackedTripIds
// below discards. That ts is otherwise free: this function fetches nothing getTrackedTripIds
// didn't already fetch, it just stops throwing the timestamp away.
export async function getTrackedTripEntries(userId: number, years: number[]): Promise<TrackIndexEntry[]> {
  const entries: TrackIndexEntry[] = []
  let firstError: unknown

  await runWithConcurrencyLimit(
    years,
    YEAR_FETCH_CONCURRENCY,
    (year) => getTracksForPilot(userId, year),
    (_year, outcome) => {
      if (outcome.ok) {
        entries.push(...outcome.value)
      } else {
        // Preserve the original Promise.all-style contract (any one year failing fails
        // the whole call) rather than silently returning a partial result — callers
        // (the recent-flights route, the pilot logbook page) already treat this function
        // failing as "this pilot's page/entry failed", which a partial track set would
        // undermine by understating which flights actually have a GPS track.
        firstError ??= outcome.error
      }
    },
  )

  if (firstError !== undefined) throw firstError
  return entries
}

// The pilot logbook page only needs "does this trip have a track", never the timestamp — kept
// as its own function (delegating to getTrackedTripEntries, not a second fetch loop) so that
// caller doesn't have to build a Set out of a TrackIndexEntry[] itself.
export async function getTrackedTripIds(userId: number, years: number[]): Promise<Set<number>> {
  const entries = await getTrackedTripEntries(userId, years)
  return new Set(entries.map((entry) => entry.tripId))
}

export async function hasTrack(tripId: number): Promise<boolean> {
  'use cache'
  cacheLife('days')
  cacheTag(`trip-${tripId}`)

  const entries = await fetchTrackIndex(`rqtid=${TRACK_INDEX_BY_TRIP}&trip_id=${tripId}`)
  return entries.length > 0
}

export async function getTrack(tripId: number): Promise<Track> {
  'use cache'
  cacheLife('days')
  cacheTag(`trip-${tripId}`)

  const kml = await fetchFlightlogText(`/fl.html?rqtid=${TRACK_KML}&trip_id=${tripId}`, {
    referer: `${FLIGHTLOG_ORIGIN}/fl.html?l=1&a=34&trip_id=${tripId}`,
  })
  return parseTrack(kml, tripId)
}
