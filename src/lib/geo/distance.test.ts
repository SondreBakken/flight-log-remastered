import { describe, expect, it } from 'vitest'
import { haversineDistanceMetres, type GeoPoint } from './distance'

const EARTH_RADIUS_METRES = 6_371_000

describe('haversineDistanceMetres', () => {
  it('returns 0 for a point against itself', () => {
    const point: GeoPoint = { lat: 60.39, lon: 5.32 }
    expect(haversineDistanceMetres(point, point)).toBe(0)
  })

  // Independent, closed-form expectations — not derived by calling the function under test.
  // Along a meridian (equal longitude), the great-circle arc length is exactly R * Δlat in
  // radians, with no trigonometric approximation needed to state that expectation.
  it('one degree of latitude along a meridian is R * (π/180) metres', () => {
    const expected = EARTH_RADIUS_METRES * (Math.PI / 180)
    expect(haversineDistanceMetres({ lat: 10, lon: 20 }, { lat: 11, lon: 20 })).toBeCloseTo(expected, 0)
  })

  // A quarter of the earth's circumference — equator to pole along a fixed meridian — is
  // exactly (π/2) * R, a second independent closed form distinct from the one above.
  it('equator to pole (90 degrees of latitude) is a quarter circumference, (π/2) * R', () => {
    const expected = (Math.PI / 2) * EARTH_RADIUS_METRES
    expect(haversineDistanceMetres({ lat: 0, lon: 0 }, { lat: 90, lon: 0 })).toBeCloseTo(expected, 0)
  })

  // Antipodal points on the equator — half the earth's circumference, π * R.
  it('antipodal points on the equator (180 degrees of longitude apart) are half circumference, π * R', () => {
    const expected = Math.PI * EARTH_RADIUS_METRES
    expect(haversineDistanceMetres({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(expected, 0)
  })

  it('is symmetric: distance(a, b) equals distance(b, a)', () => {
    const a: GeoPoint = { lat: 59.9139, lon: 10.7522 }
    const b: GeoPoint = { lat: 60.3913, lon: 5.3221 }
    expect(haversineDistanceMetres(a, b)).toBe(haversineDistanceMetres(b, a))
  })

  // A real-world sanity check against a publicly known great-circle distance (Oslo–Bergen,
  // ~305 km), sourced independently of this module, not computed through it.
  it('matches the known real-world great-circle distance between Oslo and Bergen (~305 km)', () => {
    const oslo: GeoPoint = { lat: 59.9139, lon: 10.7522 }
    const bergen: GeoPoint = { lat: 60.3913, lon: 5.3221 }
    const distanceKm = haversineDistanceMetres(oslo, bergen) / 1000
    expect(distanceKm).toBeGreaterThan(300)
    expect(distanceKm).toBeLessThan(310)
  })
})
