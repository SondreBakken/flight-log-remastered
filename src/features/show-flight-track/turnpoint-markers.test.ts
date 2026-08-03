import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '@/lib/flightlog/types'
import { groupTurnpointMarkers, turnpointGroupLabel } from './turnpoint-markers'

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

// letters is the type's single source of truth (no separate label field) — every assertion
// below reads the display label through turnpointGroupLabel, the same function track-map.tsx
// calls at its own render site, so a mutation of its '/' separator fails here too.
describe('groupTurnpointMarkers', () => {
  it('no collision: every turnpoint resolves to a distinct coordinate, one single-letter group per turnpoint in order', () => {
    const groups = groupTurnpointMarkers([0, 1, 2, 3, 4], POINTS)

    expect(groups).toHaveLength(5)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(groups.map((g) => g.letters)).toEqual([['A'], ['B'], ['C'], ['D'], ['E']])
    expect(groups.map((g) => g.point)).toEqual([0, 1, 2, 3, 4].map((i) => POINTS[i]))
  })

  it('empty turnpointIndices: no turnpoints, no groups', () => {
    const groups = groupTurnpointMarkers([], POINTS)

    expect(groups).toEqual([])
  })

  it('same-array-element duplicate (track-984290 shape): two positions resolving to the same index merge into one D/E badge', () => {
    const groups = groupTurnpointMarkers([0, 1, 2, 3, 3], POINTS)

    expect(groups).toHaveLength(4)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A', 'B', 'C', 'D/E'])
    expect(turnpointGroupLabel(groups[3])).toBe('D/E')
    expect(groups[3].letters).toEqual(['D', 'E'])
    expect(groups[3].point).toEqual(POINTS[3])
  })

  it('distinct-index/equal-coordinate duplicate (track-985713 shape): two DIFFERENT indices resolving to the same coordinate merge into one A/B badge', () => {
    const groups = groupTurnpointMarkers([0, 5, 2, 3, 4], POINTS)

    expect(groups).toHaveLength(4)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A/B', 'C', 'D', 'E'])
    expect(turnpointGroupLabel(groups[0])).toBe('A/B')
    expect(groups[0].letters).toEqual(['A', 'B'])
    // The merged group keeps the first occurrence's own point, not the later duplicate's.
    expect(groups[0].point).toEqual(POINTS[0])
  })

  it('two colliding NON-ADJACENT letters (A and C sharing a coordinate, B between them distinct) still merge, as A/C', () => {
    const groups = groupTurnpointMarkers([0, 1, 5, 3, 4], POINTS)

    expect(groups).toHaveLength(4)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A/C', 'B', 'D', 'E'])
    expect(turnpointGroupLabel(groups[0])).toBe('A/C')
    expect(groups[0].letters).toEqual(['A', 'C'])
  })

  it('three-way merge: three positions resolving to the same coordinate collapse into one C/D/E badge', () => {
    const groups = groupTurnpointMarkers([0, 1, 2, 2, 2], POINTS)

    expect(groups).toHaveLength(3)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A', 'B', 'C/D/E'])
    expect(turnpointGroupLabel(groups[2])).toBe('C/D/E')
    expect(groups[2].letters).toEqual(['C', 'D', 'E'])
  })

  it('first-and-last merge: A and E sharing a coordinate merge into A/E, leaving B/C/D between them distinct', () => {
    const groups = groupTurnpointMarkers([0, 1, 2, 3, 5], POINTS)

    expect(groups).toHaveLength(4)
    expect(groups.map(turnpointGroupLabel)).toEqual(['A/E', 'B', 'C', 'D'])
    expect(turnpointGroupLabel(groups[0])).toBe('A/E')
    expect(groups[0].letters).toEqual(['A', 'E'])
  })
})
