import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http-core'
import { ENGLISH } from './language'
import { parseTakeoffDetail } from './parse-takeoff-detail'
import type { TakeoffDetail } from './types'

const TAKEOFF_DETAIL = 22
// The real page a browser lands on right before opening a specific takeoff's detail (see
// this fixture's own breadcrumb: Home -> Takeoffs -> <Country> -> <takeoff>) — a=21 is "Takeoffs
// in a country", the same reasoning getClubs uses for its own referer.
const TAKEOFFS_IN_COUNTRY = 21

// The uncached request-plus-parse behind getTakeoffDetail; null means flightlog.org has no
// takeoff at this id for this country. Next-free so the backfill script can call it too.
export async function fetchTakeoffDetail(countryId: number, takeoffId: number): Promise<TakeoffDetail | null> {
  const html = await fetchFlightlogText(
    `/fl.html?l=${ENGLISH}&a=${TAKEOFF_DETAIL}&country_id=${countryId}&start_id=${takeoffId}`,
    { referer: `${FLIGHTLOG_ORIGIN}/fl.html?l=${ENGLISH}&a=${TAKEOFFS_IN_COUNTRY}&country_id=${countryId}` },
  )
  return parseTakeoffDetail(html, takeoffId)
}
