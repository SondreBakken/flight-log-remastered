// Reads process.env.FLIGHTLOG_PILOT_ID, which has no NEXT_PUBLIC_ prefix and is therefore
// never in the client bundle's env shim — importing this from a 'use client' module would
// silently freeze DEFAULT_PILOT_ID at FALLBACK_PILOT_ID in the browser regardless of the
// real env var. 'server-only' turns that mistake into a build/dev-time error instead.
import 'server-only'

const FALLBACK_PILOT_ID = 12677

export const DEFAULT_PILOT_ID = Number(process.env.FLIGHTLOG_PILOT_ID ?? FALLBACK_PILOT_ID)

export function flightlogFlightUrl(tripId: number): string {
  return `https://flightlog.org/fl.html?l=1&a=34&trip_id=${tripId}`
}
