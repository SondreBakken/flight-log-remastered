import type { Takeoff } from '@/lib/flightlog/types'

// Positional tuple, not a keyed object — measured against this exact payload, the gzip gap
// against a GeoJSON encoding is a modest 1.20x; what Vercel actually serves modern browsers
// is Brotli, which narrows that to 1.09x. The reasoning doesn't hinge on either number: the
// bigger point is that GeoJSON's per-row `properties`/`geometry.coordinates` indirection is
// exactly what a per-keystroke search wants to avoid, and a flat tuple avoids it without
// paying keyed objects' redundant key-name bytes either.
//
// Field order is fixed to parse-takeoffs.ts's TAKEOFF_HEADER order (id, name, lat, lon,
// wind, country_id, region_id, subregion_id, altitude, altitudediff) — for a tuple, unlike a
// keyed object, that order IS the contract: nothing on the wire names which position is
// which, so TAKEOFF_HEADER, this type, and encodeTakeoffRow must all agree on it by
// construction, not by chance. There is no positional decoder on the other end — consumers
// only validate shape (isTakeoffRows) and read fields by their fixed index directly.
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
// alongside the type and the validator below.
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

// `typeof x === 'number'` alone cannot tell two numeric fields apart from each other — every
// field here is a number, so a positional swap between any two of them (e.g. lat and
// altitude) passes a type-only check identically to the correct order. lat/lon/wind have
// known, narrow real-world ranges (see types.ts's own doc comment on wind: confirmed 0-255
// across all 6012 sampled Norway rows; lat/lon are geographic coordinates, never outside
// ±90/±180), so bounding them turns a same-typed positional swap into something this check
// can actually catch: real altitude values (frequently >90, unbounded above) fail the lat
// bound the moment they land in lat's position, and vice versa.
function isTakeoffRow(value: unknown): value is TakeoffRow {
  if (!Array.isArray(value) || value.length !== TAKEOFF_ROW_LENGTH) return false
  const [takeoffId, name, lat, lon, wind, countryId, regionId, subregionId, altitude, altitudeDiff] = value as unknown[]
  return (
    typeof takeoffId === 'number' &&
    typeof name === 'string' &&
    typeof lat === 'number' &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lon === 'number' &&
    lon >= -180 &&
    lon <= 180 &&
    typeof wind === 'number' &&
    wind >= 0 &&
    wind <= 255 &&
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
