import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { ENGLISH } from './config'
import { parseCountryFlights, parseCountryFlightDays } from './parse-country-flights'
import type { TakeoffFlight } from './types'

const FLIGHTS_IN_COUNTRY = 47
const FLIGHTS_BY_COUNTRY_OVERVIEW = 48

// How many newest rows callers look at. The list is topped up to this many (when the day on the
// bare page is short) so the first CANDIDATE_LIMIT rows are the newest flights.
export const CANDIDATE_LIMIT = 5

function countryFlightsPath(countryId: number): string {
  return `/fl.html?l=${ENGLISH}&a=${FLIGHTS_IN_COUNTRY}&country_id=${countryId}`
}

// The bare a=47 page lists only the newest day (one flight early in the day), above a date index.
// When that leaves fewer than CANDIDATE_LIMIT rows, the newest earlier day is fetched and its
// rows appended, so the list stays newest first.
export async function getCountryFlights(countryId: number): Promise<TakeoffFlight[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('recent-flights')

  const referer = `${FLIGHTLOG_ORIGIN}/fl.html?l=${ENGLISH}&a=${FLIGHTS_BY_COUNTRY_OVERVIEW}&country_id=${countryId}`
  const bareHtml = await fetchFlightlogText(countryFlightsPath(countryId), { referer })
  const newest = parseCountryFlights(bareHtml, countryId)
  if (newest.length >= CANDIDATE_LIMIT) return newest

  const lastDate = newest.at(-1)?.date ?? null
  const earlierDay = parseCountryFlightDays(bareHtml).find((day) => lastDate === null || day < lastDate)
  if (earlierDay === undefined) return newest

  const dayHtml = await fetchFlightlogText(
    `${countryFlightsPath(countryId)}&year=${earlierDay.slice(0, 4)}&tripdate=${earlierDay}`,
    { referer },
  )
  return [...newest, ...parseCountryFlights(dayHtml, countryId)]
}
