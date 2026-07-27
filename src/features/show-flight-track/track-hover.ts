import type { TrackPoint } from '@/lib/flightlog/types'

// The barogram renders a downsampled ~400-point set while the map renders the full
// ~7000-point track (see barogram-math.ts's DEFAULT_MAX_POINTS comment), so the two views
// never share an index space directly. `secondsFromStart` looked like a shared identity but
// is not one: parse-track.ts falls back to the raw array index for any point past the end
// of the recorded seconds array, and that fallback tail can repeat values already used
// earlier in the track. A shared hover position is instead an INDEX into the full, always
// unique-by-construction track array (see track-hover-view.tsx, which owns that array and
// the hovered index derived from it); `indexByPoint` below is how a point sampled from that
// array — by either view — is translated back to it.

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

/**
 * Maps each point in `points` to its own array index, by object identity. A downsampled or
 * sorted derivative of `points` (see downsampleByMinMax, sortBySeconds) holds references
 * into the same array rather than copies, so looking a sampled point back up here recovers
 * its position in the full track — the shared identity both hover views drive off.
 */
export function indexByPoint(points: TrackPoint[]): Map<TrackPoint, number> {
  return new Map(points.map((point, index) => [point, index]))
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

// Weighting the longitude delta by cos(latitude) is what makes this a genuine (if small-area)
// equirectangular approximation rather than treating degrees of longitude and latitude as
// equal distances: at this track's ~62N latitude, a degree of longitude is only ~47% as wide
// as a degree of latitude, so an unweighted comparison over-weights east-west separation by
// roughly 2x. That matters most where the track crosses itself: an unweighted scan can pick
// the wrong pass through the same point, since the two passes differ mostly in time, not
// space, and the (wrongly) larger east-west term can outvote the real spatial separation.
function squaredDegreeDistance(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
  cosLat: number,
): number {
  const dLon = (a.lon - b.lon) * cosLat
  const dLat = a.lat - b.lat
  return dLon * dLon + dLat * dLat
}

/**
 * Finds the index of the point closest in space to a map cursor position, by plain
 * squared-distance scan over the full track. Returns an index (not a point) because that
 * index is the shared hover identity both views drive off — see the module doc comment.
 *
 * A single flight's track spans a small enough area that latitude-weighted squared-degree
 * distance preserves the *ordering* of distances the same way a true haversine distance
 * would, so it is used here instead: no sorted spatial key exists to binary-search the way
 * elapsed time does above, and this map-only listener is scoped to pointer events over the
 * rendered track layer (see track-map.tsx), not every pointer move over the whole map, so
 * a ~7000-point scan only runs while the cursor is actually on the line.
 */
export function nearestIndexByLocation(
  points: TrackPoint[],
  lon: number,
  lat: number,
): number | null {
  if (points.length === 0) return null

  const cosLat = Math.cos(toRadians(lat))
  let nearestIndex = 0
  let nearestDistance = squaredDegreeDistance(points[0], { lon, lat }, cosLat)
  for (let i = 1; i < points.length; i++) {
    const distance = squaredDegreeDistance(points[i], { lon, lat }, cosLat)
    if (distance < nearestDistance) {
      nearestIndex = i
      nearestDistance = distance
    }
  }
  return nearestIndex
}
