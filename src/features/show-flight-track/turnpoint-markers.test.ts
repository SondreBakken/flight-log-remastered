import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '@/lib/flightlog/types'
import { groupTurnpointMarkers } from './turnpoint-markers'

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

describe('groupTurnpointMarkers', () => {
  it('no collision: every turnpoint resolves to a distinct coordinate, one single-letter group per turnpoint in order', () => {
    const groups = groupTurnpointMarkers([0, 1, 2, 3, 4], POINTS)

    expect(groups).toHaveLength(5)
    expect(groups.map((g) => g.label)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(groups.map((g) => g.letters)).toEqual([['A'], ['B'], ['C'], ['D'], ['E']])
    expect(groups.map((g) => g.point)).toEqual([0, 1, 2, 3, 4].map((i) => POINTS[i]))
  })

  it('same-array-element duplicate (track-984290 shape): two positions resolving to the same index merge into one D/E badge', () => {
    const groups = groupTurnpointMarkers([0, 1, 2, 3, 3], POINTS)

    expect(groups).toHaveLength(4)
    expect(groups.map((g) => g.label)).toEqual(['A', 'B', 'C', 'D/E'])
    expect(groups[3].letters).toEqual(['D', 'E'])
    expect(groups[3].point).toEqual(POINTS[3])
  })

  it('distinct-index/equal-coordinate duplicate (track-985713 shape): two DIFFERENT indices resolving to the same coordinate merge into one A/B badge', () => {
    const groups = groupTurnpointMarkers([0, 5, 2, 3, 4], POINTS)

    expect(groups).toHaveLength(4)
    expect(groups.map((g) => g.label)).toEqual(['A/B', 'C', 'D', 'E'])
    expect(groups[0].letters).toEqual(['A', 'B'])
    // The merged group keeps the first occurrence's own point, not the later duplicate's.
    expect(groups[0].point).toEqual(POINTS[0])
  })

  it('non-adjacent letters at genuinely different coordinates never merge', () => {
    const groups = groupTurnpointMarkers([0, 1, 2, 3, 4], POINTS)

    expect(groups).toHaveLength(5)
    expect(groups.every((g) => g.letters.length === 1)).toBe(true)
  })

  it('two colliding NON-ADJACENT letters (A and C sharing a coordinate, B between them distinct) still merge, as A/C', () => {
    const groups = groupTurnpointMarkers([0, 1, 5, 3, 4], POINTS)

    expect(groups).toHaveLength(4)
    expect(groups.map((g) => g.label)).toEqual(['A/C', 'B', 'D', 'E'])
    expect(groups[0].letters).toEqual(['A', 'C'])
  })
})
