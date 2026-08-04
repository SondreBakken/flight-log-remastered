import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '@/lib/flightlog/types'
import { groupTurnpointMarkersByPixelDistance, turnpointGroupLabel } from './turnpoint-markers'

// Six points, indices 0-5, lon/lat spaced so a wrong index picks a visibly wrong coordinate —
// except index 5, deliberately set to the exact same coordinate as index 0 (a different array
// element resolving to an identical point, the shape track-985713's own A/B collision has).
const POINTS: TrackPoint[] = [0, 1, 2, 3, 4].map((index) => ({
  lon: 9 + index,
  lat: 61 + index,
  altitude: 800 + index,
  secondsFromStart: index,
}))
POINTS.push({ ...POINTS[0], altitude: 900, secondsFromStart: 5 })

// An identity stand-in for a real map projection: distinct lon/lat pairs a whole degree apart
// project to pixel distances far past any threshold used below, and an exact lon/lat match
// projects to pixel distance zero, so exact-coordinate grouping (#78) falls out of the
// pixel-distance function as the distance-zero case, with no separate exact-equality code path
// to keep in sync.
const identityProjector = (point: { lon: number; lat: number }) => ({ x: point.lon, y: point.lat })

// letters is the type's single source of truth (no separate label field) — every assertion
// below reads the display label through turnpointGroupLabel, the same function track-map.tsx
// calls at its own render site, so a mutation of its '/' separator fails here too.
describe('groupTurnpointMarkersByPixelDistance — exact-coordinate collisions (#78), identity projector, threshold 0', () => {
  it('no collision: every turnpoint resolves to a distinct coordinate, one single-letter group per turnpoint in order', () => {
    const groups = groupTurnpointMarkersByPixelDistance([0, 1, 2, 3, 4], POINTS, identityProjector, 0)

    expect(groups).toHaveLength(5)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(groups.map((g) => g.letters)).toEqual([['A'], ['B'], ['C'], ['D'], ['E']])
    expect(groups.map((g) => g.point)).toEqual([0, 1, 2, 3, 4].map((i) => POINTS[i]))
  })

  it('empty turnpointIndices: no turnpoints, no groups', () => {
    const groups = groupTurnpointMarkersByPixelDistance([], POINTS, identityProjector, 0)

    expect(groups).toEqual([])
  })

  it('same-array-element duplicate (track-984290 shape): two positions resolving to the same index merge into one D/E badge', () => {
    const groups = groupTurnpointMarkersByPixelDistance([0, 1, 2, 3, 3], POINTS, identityProjector, 0)

    expect(groups).toHaveLength(4)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A', 'B', 'C', 'D/E'])
    expect(turnpointGroupLabel(groups[3])).toBe('D/E')
    expect(groups[3].letters).toEqual(['D', 'E'])
    expect(groups[3].point).toEqual(POINTS[3])
  })

  it('distinct-index/equal-coordinate duplicate (track-985713 shape): two DIFFERENT indices resolving to the same coordinate merge into one A/B badge', () => {
    const groups = groupTurnpointMarkersByPixelDistance([0, 5, 2, 3, 4], POINTS, identityProjector, 0)

    expect(groups).toHaveLength(4)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A/B', 'C', 'D', 'E'])
    expect(turnpointGroupLabel(groups[0])).toBe('A/B')
    expect(groups[0].letters).toEqual(['A', 'B'])
    // The merged group keeps the first occurrence's own point, not the later duplicate's.
    expect(groups[0].point).toEqual(POINTS[0])
  })

  it('two colliding NON-ADJACENT letters (A and C sharing a coordinate, B between them distinct) still merge, as A/C', () => {
    const groups = groupTurnpointMarkersByPixelDistance([0, 1, 5, 3, 4], POINTS, identityProjector, 0)

    expect(groups).toHaveLength(4)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A/C', 'B', 'D', 'E'])
    expect(turnpointGroupLabel(groups[0])).toBe('A/C')
    expect(groups[0].letters).toEqual(['A', 'C'])
  })

  it('three-way merge: three positions resolving to the same coordinate collapse into one C/D/E badge', () => {
    const groups = groupTurnpointMarkersByPixelDistance([0, 1, 2, 2, 2], POINTS, identityProjector, 0)

    expect(groups).toHaveLength(3)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A', 'B', 'C/D/E'])
    expect(turnpointGroupLabel(groups[2])).toBe('C/D/E')
    expect(groups[2].letters).toEqual(['C', 'D', 'E'])
  })

  it('first-and-last merge: A and E sharing a coordinate merge into A/E, leaving B/C/D between them distinct', () => {
    const groups = groupTurnpointMarkersByPixelDistance([0, 1, 2, 3, 5], POINTS, identityProjector, 0)

    expect(groups).toHaveLength(4)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A/E', 'B', 'C', 'D'])
    expect(turnpointGroupLabel(groups[0])).toBe('A/E')
    expect(groups[0].letters).toEqual(['A', 'E'])
  })
})

// A standard spherical Web Mercator projection (the same formula, and the same 512px tile size,
// MapLibre GL JS itself uses internally for map.project) so these fixtures exercise the real
// #83 case with real numbers, not an invented distance scale. Verified against the scout's own
// browser measurements on fixtures/track-985713.kml before being trusted here: at the flight's
// real fit zoom (13.86) this reproduces the flat triangle's D/E pair at ~3.55px apart (measured
// ~3.6px) and the FAI triangle's A/B pair at ~6.00px and D/E pair at ~0.71px (measured 6.0px and
// 0.7px) — see track-map.tsx's own TURNPOINT_GROUPING_THRESHOLD_PX for why 20px (the badge's own
// diameter) is the production threshold these fixtures are checked against.
function webMercatorProjector(zoom: number) {
  const worldSize = 512 * 2 ** zoom
  return (point: { lon: number; lat: number }) => {
    const x = ((point.lon + 180) / 360) * worldSize
    const sinLat = Math.sin((point.lat * Math.PI) / 180)
    const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize
    return { x, y }
  }
}

// track-985713's flat triangle (fixtures/track-985713.kml, FsInfo track_idx="13 14 157 353
// 354"): A and B (track_idx 13/14) are the pre-existing exact-coordinate collision (#78); D and E
// (track_idx 353/354, ~9.4 m apart) are #83's own case — near, never coordinate-equal.
const FLAT_TRIANGLE_D: TrackPoint = { lon: 10.045983, lat: 59.762133, altitude: 289, secondsFromStart: 354 }
const FLAT_TRIANGLE_E: TrackPoint = { lon: 10.04595, lat: 59.76205, altitude: 288, secondsFromStart: 355 }
const FIT_ZOOM = 13.86
const BADGE_DIAMETER_PX = 20

describe('groupTurnpointMarkersByPixelDistance — near-identical collisions (#83), Web Mercator projector', () => {
  it('near pair within threshold merges: 985713 flat-triangle D/E, ~3.55px apart at fit zoom 13.86, under the 20px badge', () => {
    const points = [FLAT_TRIANGLE_D, FLAT_TRIANGLE_E]
    const groups = groupTurnpointMarkersByPixelDistance([0, 1], points, webMercatorProjector(FIT_ZOOM), BADGE_DIAMETER_PX)

    expect(groups).toHaveLength(1)
    expect(turnpointGroupLabel(groups[0])).toBe('A/B')
  })

  it('pair beyond threshold stays separate: the same near D/E points, but a threshold tighter than their ~3.55px gap', () => {
    const points = [FLAT_TRIANGLE_D, FLAT_TRIANGLE_E]
    const TIGHTER_THAN_THE_GAP_PX = 2
    const groups = groupTurnpointMarkersByPixelDistance([0, 1], points, webMercatorProjector(FIT_ZOOM), TIGHTER_THAN_THE_GAP_PX)

    expect(groups).toHaveLength(2)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A', 'B'])
  })

  it('zoom-reactive: the same D/E coordinates that merge at fit zoom 13.86 separate once zoomed in to 18 (~62.7px apart), same 20px threshold', () => {
    const points = [FLAT_TRIANGLE_D, FLAT_TRIANGLE_E]
    const ZOOMED_IN = 18

    const atFitZoom = groupTurnpointMarkersByPixelDistance([0, 1], points, webMercatorProjector(FIT_ZOOM), BADGE_DIAMETER_PX)
    const atZoomedIn = groupTurnpointMarkersByPixelDistance([0, 1], points, webMercatorProjector(ZOOMED_IN), BADGE_DIAMETER_PX)

    expect(atFitZoom).toHaveLength(1)
    expect(atZoomedIn).toHaveLength(2)
    expect(atZoomedIn.map(turnpointGroupLabel)).toEqual(['A', 'B'])
  })

  it('transitive chain: A-near-B and B-near-C (but A and C themselves beyond threshold) still merge into one A/B/C badge', () => {
    // Pixel-space fixture, not real geo coordinates: the projector below reads back whatever
    // fake lon each point carries as its pixel x, so A/B/C land at x=0/15/30 — each adjacent
    // pair 15px apart (within a 20px threshold), but A and C 30px apart (beyond it).
    const chainProjector = (point: { lon: number; lat: number }) => ({ x: point.lon, y: 0 })
    const points: TrackPoint[] = [0, 15, 30].map((x) => ({ lon: x, lat: 0, altitude: 0, secondsFromStart: 0 }))

    const groups = groupTurnpointMarkersByPixelDistance([0, 1, 2], points, chainProjector, BADGE_DIAMETER_PX)

    expect(groups).toHaveLength(1)
    expect(turnpointGroupLabel(groups[0])).toBe('A/B/C')
    expect(groups[0].letters).toEqual(['A', 'B', 'C'])
  })
})
