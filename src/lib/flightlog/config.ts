const FALLBACK_PILOT_ID = 12677

export const DEFAULT_PILOT_ID = Number(process.env.FLIGHTLOG_PILOT_ID ?? FALLBACK_PILOT_ID)

export function flightlogFlightUrl(tripId: number): string {
  return `https://flightlog.org/fl.html?l=1&a=34&trip_id=${tripId}`
}
