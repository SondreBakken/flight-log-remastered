import type { ScoringGeometry, TrackPoint } from '@/lib/flightlog/types'

export function toLngLat(point: TrackPoint): [number, number] {
  return [point.lon, point.lat]
}

// A line-shaped geometry draws as one ordered polyline through every turnpoint, same as
// before. A triangle draws as two separate lines instead: the closed 3-vertex loop and the
// 2-point connector joining it to the rest of the flight (see types.ts's
// TriangleScoringGeometry) — they are not one continuous path, so resolving turnpointIndices
// in order would draw a line straight across the loop instead of a closed triangle. Pulled out
// of track-map.tsx (a pure derivation, no DOM/map access) so it has a test of its own instead
// of only ever running inside a mounted map.
export function scoringLineCoordinates(
  geometry: ScoringGeometry,
  points: TrackPoint[],
): Array<[number, number][]> {
  if (geometry.shape === 'line') {
    return [geometry.turnpointIndices.map((index) => toLngLat(points[index]))]
  }
  const closedLoop = [...geometry.loopIndices, geometry.loopIndices[0]]
  return [
    closedLoop.map((index) => toLngLat(points[index])),
    geometry.connectorIndices.map((index) => toLngLat(points[index])),
  ]
}
