import { NextResponse } from 'next/server'
import { getPilotLogbook } from '@/lib/flightlog/flights'
import { getTrackedTripIds } from '@/lib/flightlog/tracks'
import { loadRecentFlightsForPilot } from '@/features/browse-flight-feed/feed'
import { isValidPilotId } from '@/lib/follow-store/follow-ids'
import type { RecentFlightsErrorBody, RecentFlightsSuccessBody } from './contract'

type RouteParams = { params: Promise<{ userId: string }> }

// Bounds the id echoed back in the 400 body: :userId is unauthenticated user input straight
// off the URL, so without a cap a long garbage segment would be reflected back at whatever
// length the caller sent it.
const MAX_ECHOED_USER_ID_LENGTH = 32

// The pilot data underneath is cached for hours (see getPilotLogbook/getTracksForPilot), so
// a short public cache on this route just saves re-doing the merge/slice work for repeat
// loads within that window — it is not the source of truth for freshness.
const CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300'

// The frontpage feed fetches one of these per followed pilot, in parallel, bounded
// client-side (see use-flight-feed.ts) — not a server action, which Next.js dispatches
// one at a time per client and which would serialise the whole feed. A route handler
// lets each pilot's request fail independently: this file never throws past its own
// try/catch, so one dead pilot returns a 502 for itself and the rest of the feed still
// renders.
export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const { userId } = await params
  const pilotId = Number(userId)
  if (!isValidPilotId(pilotId)) {
    const body: RecentFlightsErrorBody = { error: `invalid pilot id: ${userId.slice(0, MAX_ECHOED_USER_ID_LENGTH)}` }
    return NextResponse.json(body, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    // getPilotLogbook returns a pilot's ENTIRE history; loadRecentFlightsForPilot slices it
    // down BEFORE resolving which flights have a GPS track — see its doc comment for why
    // the years passed to getTrackedTripIds must come from the slice, never the full
    // history.
    const logbook = await getPilotLogbook(pilotId)
    const body: RecentFlightsSuccessBody = await loadRecentFlightsForPilot(pilotId, logbook, getTrackedTripIds)
    return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_CONTROL } })
  } catch (error) {
    // error.message embeds the scraped-from path (see http.ts: "flightlog.org returned 500
    // for /fl.html?..."), which must never reach the client — this is the first route
    // handler in the repo, and the pattern that gets copied. Log the real cause for
    // operators; the client gets a stable, generic string it can safely render verbatim.
    console.error(`recent-flights: pilot ${pilotId} failed`, error)
    const body: RecentFlightsErrorBody = { error: `could not load recent flights for pilot ${pilotId}` }
    return NextResponse.json(body, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
