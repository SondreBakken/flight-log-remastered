import type { TrackPoint } from '@/lib/flightlog/types'

// The barogram renders a downsampled ~400-point set while the map renders the full
// ~7000-point track (see barogram-math.ts's DEFAULT_MAX_POINTS comment), so the two views
// never share an index space. `secondsFromStart` is the one property both a downsampled
// and a full-resolution point carry with the same meaning, so it is what a hover in one
// view resolves *to*, and what the other view resolves a point *from* — never an array
// position from either side.

/**
 * Sorts points by elapsed time. `secondsFromStart` is not guaranteed monotonic across a
 * full track: parse-track.ts falls back to the raw array index for any point past the end
 * of the recorded seconds array, which can dip below prior values once the fallback
 * starts. Binary search requires a genuinely sorted key, so this sorts explicitly rather
 * than trusting the input order.
 */
export function sortBySeconds(points: TrackPoint[]): TrackPoint[] {
  return [...points].sort((a, b) => a.secondsFromStart - b.secondsFromStart)
}

/**
 * Finds the point closest in elapsed time to `targetSeconds`, by binary search over an
 * already seconds-sorted array (see sortBySeconds). A target outside the series clamps to
 * the nearer end instead of returning null, so a pointer before the first point or after
 * the last still resolves to a real point.
 */
export function nearestPointBySeconds(
  sortedPoints: TrackPoint[],
  targetSeconds: number,
): TrackPoint | null {
  if (sortedPoints.length === 0) return null

  // Binary search for the first index whose seconds value is >= targetSeconds.
  let low = 0
  let high = sortedPoints.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (sortedPoints[mid].secondsFromStart < targetSeconds) low = mid + 1
    else high = mid
  }

  if (low === 0) return sortedPoints[0]
  if (low === sortedPoints.length) return sortedPoints[sortedPoints.length - 1]

  const before = sortedPoints[low - 1]
  const after = sortedPoints[low]
  const distanceBefore = targetSeconds - before.secondsFromStart
  const distanceAfter = after.secondsFromStart - targetSeconds
  return distanceBefore <= distanceAfter ? before : after
}

function squaredDegreeDistance(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
): number {
  const dLon = a.lon - b.lon
  const dLat = a.lat - b.lat
  return dLon * dLon + dLat * dLat
}

/**
 * Finds the point closest in space to a map cursor position, by plain squared-distance
 * scan over the full track.
 *
 * A single flight's track spans a small enough area that equirectangular squared-degree
 * distance preserves the *ordering* of distances the same way a true haversine distance
 * would, so it is used here instead: no sorted spatial key exists to binary-search the way
 * elapsed time does above, and this map-only listener is scoped to pointer events over the
 * rendered track layer (see track-map.tsx), not every pointer move over the whole map, so
 * a ~7000-point scan only runs while the cursor is actually on the line.
 */
export function nearestPointByLocation(
  points: TrackPoint[],
  lon: number,
  lat: number,
): TrackPoint | null {
  if (points.length === 0) return null

  let nearest = points[0]
  let nearestDistance = squaredDegreeDistance(nearest, { lon, lat })
  for (let i = 1; i < points.length; i++) {
    const distance = squaredDegreeDistance(points[i], { lon, lat })
    if (distance < nearestDistance) {
      nearest = points[i]
      nearestDistance = distance
    }
  }
  return nearest
}
