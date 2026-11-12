import { fetchFlightlogText, FLIGHTLOG_ORIGIN } from './http-core'
import { ENGLISH } from './language'
import { parseFlights, parsePilot } from './parse-flights'
import type { Flight, Pilot } from './types'

const PILOT_PAGE = 28

// The uncached request-plus-parse behind getPilotLogbook. Next-free (no 'use cache', no
// 'server-only') so the backfill script, a plain Node process, calls the same code the app does.
export async function fetchPilotPage(userId: number): Promise<{ pilot: Pilot; flights: Flight[] }> {
  const html = await fetchFlightlogText(`/fl.html?l=${ENGLISH}&a=${PILOT_PAGE}&user_id=${userId}`, {
    referer: FLIGHTLOG_ORIGIN,
  })
  return { pilot: parsePilot(html, userId), flights: parseFlights(html, userId) }
}
