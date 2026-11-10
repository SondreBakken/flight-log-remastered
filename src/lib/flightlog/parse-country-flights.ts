import * as cheerio from 'cheerio'
import { parseFlightRows, RESULTS_TABLE_SELECTOR } from './parse-takeoff-flights'
import type { TakeoffFlight } from './types'

// A real day in the page's `YYYY-MM-DD : <a ...tripdate=YYYY-MM-DD>N flights</a>` date index.
// The index also holds `YYYY-00-00` (whole year) entries, which the `(?!00)` guards exclude.
const INDEX_DATE_PATTERN = /tripdate=(\d{4}-(?!00)\d{2}-(?!00)\d{2})(?!\d)/

// a=47 (flights in a country) shares a=42's results table and 6-cell flight rows. The extra
// 2-cell takeoff-name rows between the date rows and the flight rows are not 6-cell rows, so the
// shared row walker skips them. Gated only on the table itself: unlike a=42, the page's `<h3>`
// heading names the country, not an identity this parser needs to check. An empty table is a
// genuine empty list.
export function parseCountryFlights(html: string, countryId: number): TakeoffFlight[] {
  const $ = cheerio.load(html)
  const table = $(RESULTS_TABLE_SELECTOR).first()
  if (table.length === 0) {
    throw new Error(`Country flights markup not recognised for country ${countryId}: no results table found`)
  }
  return parseFlightRows($, table, `country ${countryId}`)
}

// The days that have flights, newest first as the page lists them. A page's results table only
// holds one day (the bare page lists just the newest), so this index is how a caller finds the
// next day to fetch.
export function parseCountryFlightDays(html: string): string[] {
  const $ = cheerio.load(html)
  const days: string[] = []
  $('a[href*="tripdate="]').each((_, link) => {
    const day = $(link).attr('href')?.match(INDEX_DATE_PATTERN)?.[1]
    if (day !== undefined && !days.includes(day)) days.push(day)
  })
  return days
}
