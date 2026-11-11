import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parseCountryCounts } from './parse-country-counts'

// Entry arrays, not Maps: the cached value must serialise cleanly.
export type CountryCountEntries = {
  pilots: [number, number][]
  clubs: [number, number][]
}

// Throws on a successful response that parses to no club counts, so `use cache` never stores
// an unreadable page for days (same throw-on-unrecognised pattern as parseClubs). The caller
// (src/app/countries/page.tsx) catches and falls back to the plain country list. A failure at
// build time is likewise not cached by this function, but the prerendered fallback page it
// produced persists until the page revalidates.
export async function getCountryCounts(): Promise<CountryCountEntries> {
  'use cache'
  cacheLife('days')
  cacheTag('country-counts')

  const html = await fetchFlightlogText('/fl.html?l=1&a=3', { referer: FLIGHTLOG_ORIGIN })
  const counts = parseCountryCounts(html)
  if (counts.clubs.size === 0) {
    throw new Error('Country counts markup not recognised (a=3): no club counts parsed')
  }
  return { pilots: [...counts.pilots], clubs: [...counts.clubs] }
}
