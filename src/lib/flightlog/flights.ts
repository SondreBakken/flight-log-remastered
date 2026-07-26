import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http'
import { parseFlights, parsePilot } from './parse-flights'
import type { Flight, Pilot } from './types'

const ENGLISH = 1
const PILOT_PAGE = 28

export async function getPilotLogbook(
  userId: number,
): Promise<{ pilot: Pilot; flights: Flight[] }> {
  'use cache'
  cacheLife('hours')
  cacheTag(`pilot-${userId}`)

  const html = await fetchFlightlogText(
    `/fl.html?l=${ENGLISH}&a=${PILOT_PAGE}&user_id=${userId}`,
    { referer: FLIGHTLOG_ORIGIN },
  )

  return { pilot: parsePilot(html, userId), flights: parseFlights(html, userId) }
}
