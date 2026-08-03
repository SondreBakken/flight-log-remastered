import { describe, expect, it } from 'vitest'
import type { LineScoringGeometry, TrackPoint, TriangleScoringGeometry } from '@/lib/flightlog/types'
import { scoringLineCoordinates, toLngLat } from './scoring-line'

// Five distinct points, indices 0-4, lon/lat spaced so a wrong index picks a visibly wrong
// coordinate rather than a coincidentally identical one.
const POINTS: TrackPoint[] = [0, 1, 2, 3, 4].map((index) => ({
  lon: 9 + index,
  lat: 61 + index,
  altitude: 800 + index,
  secondsFromStart: index,
}))

function lineGeometry(overrides: Partial<LineScoringGeometry> = {}): LineScoringGeometry {
  return {
    shape: 'line',
    kind: 'distance_5_point',
    name: 'Distance over 5 points',
    distanceKm: 1,
    turnpointIndices: [0, 1, 2, 3, 4],
    ...overrides,
  }
}

function triangleGeometry(overrides: Partial<TriangleScoringGeometry> = {}): TriangleScoringGeometry {
  return {
    shape: 'triangle',
    kind: 'distance_flat_triangle',
    name: 'Flat triangle',
    distanceKm: 1,
    turnpointIndices: [0, 1, 2, 3, 4],
    loopIndices: [1, 2, 3],
    connectorIndices: [0, 4],
    ...overrides,
  }
}

describe('scoringLineCoordinates', () => {
  it('a line geometry draws as exactly one feature: one ordered polyline through every turnpoint in turn', () => {
    const lines = scoringLineCoordinates(lineGeometry(), POINTS)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual([0, 1, 2, 3, 4].map((index) => toLngLat(POINTS[index])))
  })

  it('a triangle geometry draws as exactly two features: a self-closing 4-point loop over B/C/D and a 2-point connector over A/E', () => {
    const lines = scoringLineCoordinates(triangleGeometry(), POINTS)

    expect(lines).toHaveLength(2)

    const [loop, connector] = lines
    // Self-closing: 4 coordinates, the first repeating as the last, over loopIndices [1, 2, 3].
    expect(loop).toEqual([toLngLat(POINTS[1]), toLngLat(POINTS[2]), toLngLat(POINTS[3]), toLngLat(POINTS[1])])
    // The connector is the 2-point segment over connectorIndices [0, 4] — never part of the loop.
    expect(connector).toEqual([toLngLat(POINTS[0]), toLngLat(POINTS[4])])
  })
})
