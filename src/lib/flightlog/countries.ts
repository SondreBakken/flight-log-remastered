import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parseCountries } from './parse-countries'
import type { Country } from './types'

const COUNTRY_LIST = 9

export async function getCountries(): Promise<Country[]> {
  'use cache'
  cacheLife('days')
  // No entity id to key on — this is the whole (effectively static) list, so the tag
  // names the resource itself rather than an instance of it, the way pilot-${id} or
  // trip-${id} name one.
  cacheTag('countries')

  const html = await fetchFlightlogText(`/fl.html?rqtid=${COUNTRY_LIST}`, {
    // rqtid=9 is a raw data resource, not a page a browser lands on by clicking through
    // the site — nothing on flightlog.org itself links here. Same treatment as the other
    // no-natural-referrer rqtid calls (getTracksForPilot): the site root.
    referer: FLIGHTLOG_ORIGIN,
  })
  return parseCountries(html)
}
