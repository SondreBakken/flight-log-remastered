import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parseTakeoffs } from './parse-takeoffs'
import type { Takeoff } from './types'

const TAKEOFFS_FOR_COUNTRY = 11

export async function getTakeoffs(countryId: number): Promise<Takeoff[]> {
  'use cache'
  cacheLife('days')
  // Deliberately the same tag shape getClubs uses for the same country (`country-${id}`),
  // not a takeoffs-specific tag — takeoffs, clubs and regions are all "this country's
  // snapshot from flightlog.org," invalidated together under one per-country tag.
  cacheTag(`country-${countryId}`)

  const html = await fetchFlightlogText(`/fl.html?rqtid=${TAKEOFFS_FOR_COUNTRY}&country_id=${countryId}`, {
    // rqtid=11 is a raw data resource nothing on flightlog.org itself links to — same
    // no-natural-referrer reasoning as getCountries (rqtid=9): the site root is the closest
    // honest referer.
    referer: FLIGHTLOG_ORIGIN,
  })
  return parseTakeoffs(html, countryId)
}
