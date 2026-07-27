import type { Takeoff } from '@/lib/flightlog/types'

// Positional tuple, not a keyed object — see the takeoffs API route's doc comment for the
// full measurement and reasoning (gzip gap is a real but modest 1.20x; the bigger point is
// that GeoJSON's per-row `properties`/`geometry.coordinates` indirection is exactly what a
// per-keystroke search wants to avoid, and a flat tuple avoids it without paying keyed
// objects' redundant key-name bytes either).
//
// Field order is fixed to parse-takeoffs.ts's TAKEOFF_HEADER order (id, name, lat, lon,
// wind, country_id, region_id, subregion_id, altitude, altitudediff) — for a tuple, unlike a
// keyed object, that order IS the contract: nothing on the wire names which position is
// which, so encode and decode must agree on it by construction, not by chance.
export const TAKEOFF_ROW_LENGTH = 10

export type TakeoffRow = readonly [
  takeoffId: number,
  name: string,
  lat: number,
  lon: number,
  wind: number,
  countryId: number,
  regionId: number,
  subregionId: number,
  altitude: number,
  altitudeDiff: number,
]

// Server-side only in practice (the route handler is its one caller), but kept here
// alongside the type and the validator rather than in the route file itself, so the
// three things that must agree on field order — encode, decode-by-position, and the
// boundary check below — cannot drift apart by living in different files.
export function encodeTakeoffRow(takeoff: Takeoff): TakeoffRow {
  return [
    takeoff.takeoffId,
    takeoff.name,
    takeoff.lat,
    takeoff.lon,
    takeoff.wind,
    takeoff.countryId,
    takeoff.regionId,
    takeoff.subregionId,
    takeoff.altitude,
    takeoff.altitudeDiff,
  ]
}

function isTakeoffRow(value: unknown): value is TakeoffRow {
  if (!Array.isArray(value) || value.length !== TAKEOFF_ROW_LENGTH) return false
  const [takeoffId, name, lat, lon, wind, countryId, regionId, subregionId, altitude, altitudeDiff] = value as unknown[]
  return (
    typeof takeoffId === 'number' &&
    typeof name === 'string' &&
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    typeof wind === 'number' &&
    typeof countryId === 'number' &&
    typeof regionId === 'number' &&
    typeof subregionId === 'number' &&
    typeof altitude === 'number' &&
    typeof altitudeDiff === 'number'
  )
}

// Validated at the boundary, not cast — this crossed a network hop (our own route, but
// still `unknown` on arrival), the same reasoning recent-flights/contract.ts's
// isRecentFlightsSuccessBody uses. Checks EVERY row, not just the first: a malformed row
// anywhere in 6012 is still a malformed response, and `.some`/`array[0]`-only checks are
// exactly the "a check that never runs" shape that would let the rest silently through.
export function isTakeoffRows(value: unknown): value is TakeoffRow[] {
  return Array.isArray(value) && value.every(isTakeoffRow)
}
