// Generic, domain-agnostic distance math over lat/lon points — no flightlog- or track-specific
// knowledge here. Extracted from show-flight-track/altitude-color.ts (that module's gradient
// math was the first caller) so browse-country-takeoffs's "nearby" filter (#12) reuses the same
// formula instead of writing a second one that could drift from it.
//
// What actually pins this formula: distance.test.ts's closed-form absolute-metre expectations
// (Oslo-Bergen, meridian arcs, quarter/half circumference) and check-track-gradient.mts's own
// absolute-metre assertion, added specifically because of the gap below.
//
// What does NOT pin it: check-track-gradient.mts's max-deviation-against-independent-oracle
// check compares NORMALISED fractions (distance / total distance along the track), so any
// consistent scale error on this function cancels out of that ratio entirely. Measured against
// its 1e-6 threshold, none of these were caught by that check alone: EARTH_RADIUS_METRES wrong
// by 7000m (deviation 2.44e-15), lat/lon transposed (2.07e-7), the cos(lat1)*cos(lat2) term
// dropped (2.29e-8). A green gradient check is evidence the SHAPE of the track's fractions is
// right, not that this function's absolute output is. Don't let it stand in for a real distance
// assertion on a change here.


export type GeoPoint = {
  lat: number
  lon: number
}

const EARTH_RADIUS_METRES = 6_371_000

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function haversineDistanceMetres(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lon - a.lon)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)))
}
