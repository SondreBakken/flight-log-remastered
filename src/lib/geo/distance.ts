// Generic, domain-agnostic distance math over lat/lon points — no flightlog- or track-specific
// knowledge here. Extracted from show-flight-track/altitude-color.ts (that module's gradient
// math was the first caller) so browse-country-takeoffs's "nearby" filter (#12) reuses the same
// formula instead of writing a second one that could drift from it.

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
