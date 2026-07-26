import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parseTrack } from './parse-track'
import type { Track, TrackIndexEntry } from './types'

const TRACK_INDEX_BY_PILOT = 21
const TRACK_INDEX_BY_TRIP = 22
const TRACK_KML = 19

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
export async function getTrackedTripIds(userId: number, years: number[]): Promise<Set<number>> {
  const indexes = await Promise.all(years.map((year) => getTracksForPilot(userId, year)))
  return new Set(indexes.flat().map((entry) => entry.tripId))
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
