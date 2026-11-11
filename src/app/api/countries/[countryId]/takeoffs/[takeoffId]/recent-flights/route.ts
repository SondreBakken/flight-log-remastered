import { NextResponse } from 'next/server'
import { parseCuratedCountryId } from '@/lib/flightlog/curated-countries'
import { getTakeoffDetail } from '@/lib/flightlog/takeoff-detail'
import { getTakeoffFlights } from '@/lib/flightlog/takeoff-flights'
import { sliceRecentTakeoffFlights } from '@/features/browse-flight-feed/feed'
import type { TakeoffRecentFlightsErrorBody, TakeoffRecentFlightsSuccessBody } from './contract'

type RouteParams = { params: Promise<{ countryId: string; takeoffId: string }> }

// Bounds the ids echoed back in the 400 body: both segments are unauthenticated user input.
const MAX_ECHOED_ID_LENGTH = 32

// Canonical positive decimal only, so '010' or '1e2' never reach upstream as a distinct URL (and
// a distinct CDN cache key) for the same takeoff.
const CANONICAL_POSITIVE_INTEGER = /^[1-9]\d*$/

// Same short public cache as the pilot recent-flights route: the data underneath is cached for
// hours, this only saves re-doing the slice for repeat loads.
const CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300'
const NO_STORE = { 'Cache-Control': 'no-store' }

function errorResponse(error: string, status: number): Response {
  const body: TakeoffRecentFlightsErrorBody = { error }
  return NextResponse.json(body, { status, headers: NO_STORE })
}

// The frontpage feed fetches one of these per followed takeoff, bounded client-side (see
// use-flight-feed.ts), as a route handler rather than a server action for the same reason as the
// pilot route: each takeoff must fail independently and not serialise the feed.
export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const { countryId: countryIdParam, takeoffId: takeoffIdParam } = await params
  const countryId = parseCuratedCountryId(countryIdParam)
  if (countryId === null || !CANONICAL_POSITIVE_INTEGER.test(takeoffIdParam)) {
    return errorResponse(
      `invalid takeoff: ${countryIdParam.slice(0, MAX_ECHOED_ID_LENGTH)}/${takeoffIdParam.slice(0, MAX_ECHOED_ID_LENGTH)}`,
      400,
    )
  }
  const takeoffId = Number(takeoffIdParam)

  try {
    const [detail, flights] = await Promise.all([
      getTakeoffDetail(countryId, takeoffId),
      getTakeoffFlights(countryId, takeoffId),
    ])
    // Either null means flightlog.org reports no such takeoff: a stored follow whose takeoff was
    // deleted. The client shows it as a failed site rather than an empty one.
    if (detail === null || flights === null) return errorResponse(`no takeoff ${countryId}/${takeoffId}`, 404)

    const body: TakeoffRecentFlightsSuccessBody = {
      takeoff: { countryId, takeoffId, name: detail.name },
      flights: sliceRecentTakeoffFlights(flights),
    }
    return NextResponse.json(body, { headers: { 'Cache-Control': CACHE_CONTROL } })
  } catch (error) {
    // error.message embeds the scraped-from upstream path, which must never reach the client:
    // log the cause, return a generic string (see the pilot recent-flights route).
    console.error(`recent-flights: takeoff ${countryId}/${takeoffId} failed`, error)
    return errorResponse(`could not load recent flights for takeoff ${countryId}/${takeoffId}`, 502)
  }
}
