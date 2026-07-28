import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parseTakeoffDetail } from './parse-takeoff-detail'
import type { TakeoffDetail } from './types'

const ENGLISH = 1
const TAKEOFF_DETAIL = 22
// The real page a browser lands on right before opening a specific takeoff's detail (see
// this fixture's own breadcrumb: Home -> Takeoffs -> <Country> -> <takeoff>) — a=21 is "Takeoffs
// in a country", the same reasoning getClubs uses for its own referer.
const TAKEOFFS_IN_COUNTRY = 21

// null means "flightlog.org has no takeoff at this id for this country" (see
// parseTakeoffDetail's own doc comment on why that's a valid parse, not a thrown error) — the
// page.tsx caller turns that into notFound().
export async function getTakeoffDetail(countryId: number, takeoffId: number): Promise<TakeoffDetail | null> {
  'use cache'
  cacheLife('hours')
  // Scoped to this one takeoff, not the shared `country-${countryId}` tag getTakeoffs/getClubs/
  // getRegions use — a takeoff's own description or site records changing has nothing to do
  // with the country-wide coordinate/region/club snapshot those three invalidate together.
  cacheTag(`takeoff-${countryId}-${takeoffId}`)

  const html = await fetchFlightlogText(
    `/fl.html?l=${ENGLISH}&a=${TAKEOFF_DETAIL}&country_id=${countryId}&start_id=${takeoffId}`,
    { referer: `${FLIGHTLOG_ORIGIN}/fl.html?l=${ENGLISH}&a=${TAKEOFFS_IN_COUNTRY}&country_id=${countryId}` },
  )
  return parseTakeoffDetail(html, takeoffId)
}
