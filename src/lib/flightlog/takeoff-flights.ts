import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { ENGLISH } from './config'
import { parseTakeoffFlights } from './parse-takeoff-flights'
import type { TakeoffFlight } from './types'

const FLIGHTS_AT_TAKEOFF = 42
const TAKEOFF_DETAIL = 22

// null means this response's own identity signal (see parseTakeoffFlights) reports no such
// takeoff at this id. The page.tsx caller cross-references getTakeoffDetail's own,
// independently-fetched and independently-cached result to tell "genuinely no such takeoff"
// (both null — a real 404) from "a=42 disagrees with a=22, which confirms the takeoff exists"
// (a genuine inconsistency, thrown loudly rather than cached as a confident empty list).
export async function getTakeoffFlights(countryId: number, takeoffId: number): Promise<TakeoffFlight[] | null> {
  'use cache'
  cacheLife('hours')
  cacheTag(`takeoff-${countryId}-${takeoffId}`)

  const html = await fetchFlightlogText(
    `/fl.html?l=${ENGLISH}&a=${FLIGHTS_AT_TAKEOFF}&country_id=${countryId}&start_id=${takeoffId}`,
    {
      referer: `${FLIGHTLOG_ORIGIN}/fl.html?l=${ENGLISH}&a=${TAKEOFF_DETAIL}&country_id=${countryId}&start_id=${takeoffId}`,
    },
  )
  return parseTakeoffFlights(html, takeoffId)
}
