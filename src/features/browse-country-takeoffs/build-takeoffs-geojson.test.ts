import { describe, expect, it } from 'vitest'
import { buildTakeoffsMapData, rayLengthDegreesAtZoom, rescaleRayLength } from './build-takeoffs-geojson'
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'

// Same neutral-default shape select-visible-takeoffs.test.ts uses, for the same reason: wind=0
// (not 255) as the default so a test that doesn't explicitly set wind doesn't vacuously look
// like an "all directions" site.
function makeTakeoff(overrides: Partial<TakeoffDirectoryEntry> & Pick<TakeoffDirectoryEntry, 'takeoffId' | 'name'>): TakeoffDirectoryEntry {
  return { regionId: 1, lat: 60, lon: 10, wind: 0, ...overrides }
}

describe('buildTakeoffsMapData — the placeholder-coordinate hazard', () => {
  it('never plots a takeoff with lat=0/lon=0 as a real site', () => {
    const data = buildTakeoffsMapData([
      makeTakeoff({ takeoffId: 1, name: 'RealSite', lat: 60, lon: 10 }),
      makeTakeoff({ takeoffId: 2, name: 'PlaceholderSite', lat: 0, lon: 0 }),
    ])

    expect(data.sites.features.map((f) => f.properties.name)).toEqual(['RealSite'])
  })

  it('counts every excluded placeholder takeoff, visibly, rather than dropping them silently', () => {
    const data = buildTakeoffsMapData([
      makeTakeoff({ takeoffId: 1, name: 'A', lat: 60, lon: 10 }),
      makeTakeoff({ takeoffId: 2, name: 'B', lat: 0, lon: 0 }),
      makeTakeoff({ takeoffId: 3, name: 'C', lat: 0, lon: 0 }),
    ])

    expect(data.excludedCount).toBe(2)
    expect(data.plottedCount).toBe(1)
  })

  it('a takeoff with exactly one axis reset to 0 is corruption, not a real equator/meridian position — every real occurrence in the live fixture is a broken column, not a legitimate site', () => {
    const data = buildTakeoffsMapData([
      makeTakeoff({ takeoffId: 1, name: 'LatDroppedToZero', lat: 0, lon: 10 }),
      makeTakeoff({ takeoffId: 2, name: 'LonDroppedToZero', lat: 60, lon: 0 }),
    ])

    expect(data.excludedCount).toBe(2)
    expect(data.sites.features).toEqual([])
  })

  it('a takeoff with BOTH axes corrupted to a small non-zero remainder near Null Island is also excluded, not just the exact 0,0 or single-axis-zero shapes', () => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 1, name: 'NearNullIsland', lat: -1.02, lon: 1.02 })])

    expect(data.excludedCount).toBe(1)
    expect(data.sites.features).toEqual([])
  })

  it('a real low-latitude site far from Null Island on both axes still plots (the exclusion is a radius around 0,0, not a blanket low-latitude rule)', () => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 1, name: 'RealLowLatitude', lat: 39.32, lon: 10.21 })])

    expect(data.excludedCount).toBe(0)
    expect(data.sites.features).toHaveLength(1)
  })

  it('excludedCount reflects reality even when nothing is plottable at all', () => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 1, name: 'OnlyPlaceholder', lat: 0, lon: 0 })])

    expect(data.excludedCount).toBe(1)
    expect(data.plottedCount).toBe(0)
    expect(data.sites.features).toEqual([])
  })
})

describe('buildTakeoffsMapData — site geometry', () => {
  // A GeoJSON Point's coordinates are [longitude, latitude] — the opposite order from how
  // TakeoffDirectoryEntry names its own fields. Only the ray's origin (see "every ray belongs
  // to the takeoff it was built from" below) was ever pinned against this ordering; the site
  // Point itself was asserted nowhere, so a lat/lon swap here would move every marker to the
  // wrong hemisphere while every ray — built independently, from the same raw lat/lon — stayed
  // exactly where it belonged.
  it('plots the site Point at [lon, lat], not [lat, lon]', () => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 1, name: 'Bergen', lat: 60.39, lon: 5.32 })])

    expect(data.sites.features[0]?.geometry.coordinates).toEqual([5.32, 60.39])
  })
})

describe('buildTakeoffsMapData — wind category classification', () => {
  it('wind=0 (nothing recorded) classifies as "none", not an ordinary zero-ray site indistinguishable from one that just has no active octants', () => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 1, name: 'NoWind', wind: 0 })])

    expect(data.sites.features[0]?.properties.windCategory).toBe('none')
    expect(data.sites.features[0]?.properties.windSummary).toBe('No wind direction recorded')
  })

  it('wind=255 (every direction) classifies as "all", and produces ZERO rays — not eight, which #10 explicitly rejects as a meaningful reading of "works everywhere"', () => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 1, name: 'AllWind', wind: 255 })])

    expect(data.sites.features[0]?.properties.windCategory).toBe('all')
    expect(data.sites.features[0]?.properties.windSummary).toBe('Works in every direction')
    expect(data.rays.features).toEqual([])
  })

  it('an ordinary directional value classifies as "some" and produces exactly one ray per active octant, in clockwise order', () => {
    // wind = 128 (N) | 8 (S) = 136, same fixture wind.test.ts uses to pin clockwise (not bit)
    // order.
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 1, name: 'NorthAndSouth', wind: 136 })])

    expect(data.sites.features[0]?.properties.windCategory).toBe('some')
    expect(data.sites.features[0]?.properties.windSummary).toBe('Works in N, S')
    expect(data.rays.features.map((f) => f.properties.octant)).toEqual(['N', 'S'])
  })

  it('every ray belongs to the takeoff it was built from, and starts exactly at that site (not an unrelated or offset origin)', () => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 42, name: 'Site', lat: 61, lon: 11, wind: 32 })]) // E only

    expect(data.rays.features).toHaveLength(1)
    const ray = data.rays.features[0]!
    expect(ray.properties.takeoffId).toBe(42)
    expect(ray.geometry.coordinates[0]).toEqual([11, 61])
  })

  it('a single-bit wind value produces a ray pointing the right way: N moves latitude up with no longitude drift, E moves longitude with no latitude drift', () => {
    const data = buildTakeoffsMapData([
      makeTakeoff({ takeoffId: 1, name: 'FacesNorth', lat: 60, lon: 10, wind: 128 }),
      makeTakeoff({ takeoffId: 2, name: 'FacesEast', lat: 60, lon: 10, wind: 32 }),
    ])

    const [north, east] = data.rays.features
    const [nLon, nLat] = north!.geometry.coordinates[1]
    const [eLon, eLat] = east!.geometry.coordinates[1]

    expect(nLat).toBeGreaterThan(60)
    expect(nLon).toBeCloseTo(10, 5)
    expect(eLon).toBeGreaterThan(10)
    expect(eLat).toBeCloseTo(60, 5)
  })

  // N and E alone (above) don't catch a bearing table with its four DIAGONALS mirrored (NE
  // swapped for its reflection across the N-S axis, etc) — N/E/S/W all sit exactly on an axis,
  // where a sign flip on the perpendicular axis is invisible because that component is zero
  // either way. Every octant, each isolated via its own single-bit wind value (see wind.ts's
  // own bit-to-octant table), pinned by the sign of both axes — the only shape of mutation a
  // mirrored diagonal produces.
  it.each([
    ['N', 128, { lat: 1, lon: 0 }],
    ['NE', 64, { lat: 1, lon: 1 }],
    ['E', 32, { lat: 0, lon: 1 }],
    ['SE', 16, { lat: -1, lon: 1 }],
    ['S', 8, { lat: -1, lon: 0 }],
    ['SW', 4, { lat: -1, lon: -1 }],
    ['W', 2, { lat: 0, lon: -1 }],
    ['NW', 1, { lat: 1, lon: -1 }],
  ] as const)('a %s-only wind value draws its ray into the %s octant, not a mirrored one', (_octant, wind, expected) => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 1, name: 'Site', lat: 60, lon: 10, wind })])

    const [lon, lat] = data.rays.features[0]!.geometry.coordinates[1]
    const deltaLat = lat - 60
    const deltaLon = lon - 10

    if (expected.lat === 0) expect(deltaLat).toBeCloseTo(0, 6)
    else expect(Math.sign(deltaLat)).toBe(expected.lat)
    if (expected.lon === 0) expect(deltaLon).toBeCloseTo(0, 6)
    else expect(Math.sign(deltaLon)).toBe(expected.lon)
  })

  // D2's Mercator mutation (dividing by cos(latitude) changed to multiplying) passes every
  // sign-only check above unchanged — both operations preserve sign, only magnitude differs.
  // An exact numeric expectation is what actually distinguishes "divide" from "multiply": at
  // 60N, cos(60°) = 0.5 exactly, so dividing doubles the raw ray length and multiplying halves
  // it — a 4x gap between the two readings, not a rounding-sized one.
  it('scales the east-west ray length by 1/cos(latitude), not cos(latitude) — an exact magnitude, not just a direction', () => {
    const rayLengthDegrees = 0.01
    const data = buildTakeoffsMapData(
      [makeTakeoff({ takeoffId: 1, name: 'FacesEast', lat: 60, lon: 10, wind: 32 })], // E only
      rayLengthDegrees,
    )

    const [lon] = data.rays.features[0]!.geometry.coordinates[1]
    const deltaLon = lon - 10

    expect(deltaLon).toBeCloseTo(rayLengthDegrees / Math.cos((60 * Math.PI) / 180), 10)
  })
})

describe('rayLengthDegreesAtZoom — D4: a screen-constant ray across zoom levels', () => {
  // MapLibre's Web Mercator projection doubles pixels-per-degree-longitude with every zoom
  // level, independent of latitude — so the DEGREE length that renders at a fixed pixel size
  // must halve at the same rate, the exact inverse of the 64x-over-6-levels growth a fixed
  // degree length produces (see build-takeoffs-geojson.ts's own doc comment for the measured
  // 7.3px-to-466px figures this replaces).
  it('halves for every zoom level up', () => {
    const z9 = rayLengthDegreesAtZoom(9)
    const z10 = rayLengthDegreesAtZoom(10)
    const z15 = rayLengthDegreesAtZoom(15)

    expect(z10).toBeCloseTo(z9 / 2, 10)
    expect(z15).toBeCloseTo(z9 / 64, 10)
  })

  it('is always positive, for any real zoom level', () => {
    expect(rayLengthDegreesAtZoom(0)).toBeGreaterThan(0)
    expect(rayLengthDegreesAtZoom(20)).toBeGreaterThan(0)
  })
})

describe('rescaleRayLength — recomputing ray endpoints without rebuilding the whole dataset', () => {
  it('keeps every ray’s origin and octant, only moving the endpoint to match the new length', () => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 42, name: 'Site', lat: 61, lon: 11, wind: 32 })], 0.01) // E only

    const rescaled = rescaleRayLength(data.rays, 0.05)

    expect(rescaled.features).toHaveLength(1)
    const ray = rescaled.features[0]!
    expect(ray.properties).toEqual(data.rays.features[0]!.properties)
    expect(ray.geometry.coordinates[0]).toEqual(data.rays.features[0]!.geometry.coordinates[0])
    expect(ray.geometry.coordinates[1]).not.toEqual(data.rays.features[0]!.geometry.coordinates[1])

    const [lon] = ray.geometry.coordinates[1]
    expect(lon - 11).toBeCloseTo(0.05 / Math.cos((61 * Math.PI) / 180), 10)
  })

  it('produces an equivalent result to building at that length directly', () => {
    const takeoffs = [makeTakeoff({ takeoffId: 1, name: 'Site', lat: 65, lon: 12, wind: 136 })] // N and S

    const built = buildTakeoffsMapData(takeoffs, 0.02)
    const rescaled = rescaleRayLength(buildTakeoffsMapData(takeoffs, 0.01).rays, 0.02)

    expect(rescaled).toEqual(built.rays)
  })
})

describe('buildTakeoffsMapData — composition with the placeholder-coordinate hazard', () => {
  it('a placeholder-coordinate takeoff never contributes rays either, even if it also carries wind data', () => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 1, name: 'PlaceholderWithWind', lat: 0, lon: 0, wind: 128 })])

    expect(data.sites.features).toEqual([])
    expect(data.rays.features).toEqual([])
    expect(data.excludedCount).toBe(1)
  })
})
