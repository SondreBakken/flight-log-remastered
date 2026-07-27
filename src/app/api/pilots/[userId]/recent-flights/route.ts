import { NextResponse } from 'next/server'
import { getPilotLogbook } from '@/lib/flightlog/flights'
import { getTrackedTripIds } from '@/lib/flightlog/tracks'
import { RECENT_FLIGHTS_PER_PILOT, sliceRecentFlights } from '@/features/browse-flight-feed/feed'

type RouteParams = { params: Promise<{ userId: string }> }

// The frontpage feed fetches one of these per followed pilot, in parallel, bounded
// client-side (see use-flight-feed.ts) — not a server action, which Next.js dispatches
// one at a time per client and which would serialise the whole feed. A route handler
// lets each pilot's request fail independently: this file never throws past its own
// try/catch, so one dead pilot returns a 502 for itself and the rest of the feed still
// renders.
export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const { userId } = await params
  const pilotId = Number(userId)
  if (!Number.isInteger(pilotId) || pilotId <= 0) {
    return NextResponse.json({ error: `invalid pilot id: ${userId}` }, { status: 400 })
  }

  try {
    // getPilotLogbook returns a pilot's ENTIRE history; slicing to the recent flights
    // BEFORE resolving which of them have a GPS track is what keeps a many-year pilot
    // from costing one track-index request per year they've ever flown. See
    // sliceRecentFlights's doc comment for why the years must come from the slice.
    const { pilot, flights } = await getPilotLogbook(pilotId)
    const recent = sliceRecentFlights(flights, RECENT_FLIGHTS_PER_PILOT)
    const trackedTripIds = await getTrackedTripIds(pilotId, recent.years)

    return NextResponse.json({ pilot, flights: recent.flights, trackedTripIds: [...trackedTripIds] })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : `failed to load pilot ${pilotId}` },
      { status: 502 },
    )
  }
}
