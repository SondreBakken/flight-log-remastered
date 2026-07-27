import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parseClubs } from './parse-clubs'
import type { Club } from './types'

const ENGLISH = 1
const CLUBS_IN_COUNTRY = 25
// The real flightlog.org page a browser shows right before clicking into a country's club
// list (confirmed live: the clubs-in-a-country page's own breadcrumb reads
// Home -> Pilots/Clubs -> <Country>) — not our own /countries URL, which flightlog.org has
// never served and would not look like a real referring page to it.
const COUNTRY_INDEX_PAGE = 3

export async function getClubs(countryId: number): Promise<Club[]> {
  'use cache'
  cacheLife('days')
  cacheTag(`country-${countryId}`)

  const html = await fetchFlightlogText(
    `/fl.html?l=${ENGLISH}&a=${CLUBS_IN_COUNTRY}&country_id=${countryId}`,
    { referer: `${FLIGHTLOG_ORIGIN}/fl.html?l=${ENGLISH}&a=${COUNTRY_INDEX_PAGE}` },
  )
  return parseClubs(html, countryId)
}
