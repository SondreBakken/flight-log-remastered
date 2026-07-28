import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parseTakeoffFlights } from './parse-takeoff-flights'
import type { TakeoffFlight } from './types'

const ENGLISH = 1
const FLIGHTS_AT_TAKEOFF = 42
const TAKEOFF_DETAIL = 22

// The real page a browser lands on right before opening the flights tab: the takeoff's own
// detail page (see this fixture's own breadcrumb, one level deeper than getTakeoffDetail's).
export async function getTakeoffFlights(countryId: number, takeoffId: number): Promise<TakeoffFlight[]> {
  'use cache'
  cacheLife('hours')
  cacheTag(`takeoff-${countryId}-${takeoffId}`)

  const html = await fetchFlightlogText(
    `/fl.html?l=${ENGLISH}&a=${FLIGHTS_AT_TAKEOFF}&country_id=${countryId}&start_id=${takeoffId}`,
    {
      referer: `${FLIGHTLOG_ORIGIN}/fl.html?l=${ENGLISH}&a=${TAKEOFF_DETAIL}&country_id=${countryId}&start_id=${takeoffId}`,
    },
  )
  return parseTakeoffFlights(html)
}
