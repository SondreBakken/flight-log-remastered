import { describe, expect, it } from 'vitest'
import { buildTakeoffsMapData } from './build-takeoffs-geojson'
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

  it('a takeoff at exactly lat=0 with a real lon, or vice versa, is still a real position (only 0,0 together is the placeholder)', () => {
    const data = buildTakeoffsMapData([
      makeTakeoff({ takeoffId: 1, name: 'EquatorButRealLon', lat: 0, lon: 10 }),
      makeTakeoff({ takeoffId: 2, name: 'MeridianButRealLat', lat: 60, lon: 0 }),
    ])

    expect(data.excludedCount).toBe(0)
    expect(data.sites.features).toHaveLength(2)
  })

  it('excludedCount reflects reality even when nothing is plottable at all', () => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 1, name: 'OnlyPlaceholder', lat: 0, lon: 0 })])

    expect(data.excludedCount).toBe(1)
    expect(data.plottedCount).toBe(0)
    expect(data.sites.features).toEqual([])
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
})

describe('buildTakeoffsMapData — composition with the placeholder-coordinate hazard', () => {
  it('a placeholder-coordinate takeoff never contributes rays either, even if it also carries wind data', () => {
    const data = buildTakeoffsMapData([makeTakeoff({ takeoffId: 1, name: 'PlaceholderWithWind', lat: 0, lon: 0, wind: 128 })])

    expect(data.sites.features).toEqual([])
    expect(data.rays.features).toEqual([])
    expect(data.excludedCount).toBe(1)
  })
})
