import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { ENGLISH } from './config'
import { parseFlightDetail } from './parse-flight-detail'
import type { FlightDetail } from './types'

const FLIGHT_DETAIL = 34

// #215: /flights/[tripId] only calls this for a trip `hasTrack` already reported false for —
// this app is never the one place a real browsing session would have landed on a=34 from (it's
// reachable from the pilot logbook, the recent-flights feed, a takeoff's own site records, …),
// so there is no single plausible referer the way getTrack has one in a=34 itself (the page a
// browser would be ON right before requesting the KML). The plain origin is what
// fetchTrackIndex (tracks.ts) already uses for the same "no one specific referer" reason.
//
// null means "flightlog.org has no flight at this trip_id" (see parseFlightDetail's own doc
// comment on why that's a valid parse, not a thrown error) — the page.tsx caller falls back to
// the bare no-track notice for that case, same as a genuinely untracked flight it can't
// otherwise describe.
export async function getFlightDetail(tripId: number): Promise<FlightDetail | null> {
  'use cache'
  cacheLife('days')
  // Same tag tracks.ts's own hasTrack/getTrack use for this trip — this is the same real-world
  // flight record, just a different page of it, not a separate entity that happens to share an
  // id.
  cacheTag(`trip-${tripId}`)

  const html = await fetchFlightlogText(`/fl.html?l=${ENGLISH}&a=${FLIGHT_DETAIL}&trip_id=${tripId}`, {
    referer: FLIGHTLOG_ORIGIN,
  })
  return parseFlightDetail(html, tripId)
}
