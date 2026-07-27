import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parseRegions } from './parse-regions'
import type { Region } from './types'

const REGIONS_FOR_COUNTRY = 10

export async function getRegions(countryId: number): Promise<Region[]> {
  'use cache'
  cacheLife('days')
  // Same per-country tag getClubs and getTakeoffs use — see takeoffs.ts.
  cacheTag(`country-${countryId}`)

  const html = await fetchFlightlogText(`/fl.html?rqtid=${REGIONS_FOR_COUNTRY}&country_id=${countryId}`, {
    // Same no-natural-referrer reasoning as getTakeoffs/getCountries.
    referer: FLIGHTLOG_ORIGIN,
  })
  return parseRegions(html, countryId)
}
