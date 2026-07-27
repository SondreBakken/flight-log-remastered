import type { TrackPoint } from '../src/lib/flightlog/types'
import {
  DEFAULT_CHART_BOUNDS,
  DEFAULT_MAX_POINTS,
  createAltitudeScale,
  downsampleByMinMax,
  xToSecondsFromStart,
} from '../src/features/show-flight-track/barogram-math'
import {
  indexByPoint,
  nearestIndexByLocation,
  nearestPointBySeconds,
  sortBySeconds,
} from '../src/features/show-flight-track/track-hover'

let failures = 0

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'ok' : 'FAIL'} - ${label}`)
  if (!pass) {
    failures++
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

function point(secondsFromStart: number, altitude: number, lon = 0, lat = 0): TrackPoint {
  return { lon, lat, altitude, secondsFromStart }
}

// Reused from check-barogram.mts: not a round number, so bucket-split remainder logic
// actually runs, and matches the real fixture's point count.
const REAL_FIXTURE_POINT_COUNT = 6972

// A spiral, not a straight line: a slow net drift with several tight circling loops on top
// of it, the way a real thermalling flight looks (see check-track-gradient.mts's
// syntheticFlight for the full rationale). Kept near latitude 0 so cos(latitude) is ~1 and
// the plain-Euclidean brute-force oracle below stays a valid ground truth for it; the
// dedicated high-latitude fixture further down is what exercises cos(latitude) weighting.
function syntheticFlight(count: number): TrackPoint[] {
  const loops = 12
  const thermalRadiusDegrees = 0.02
  const netDriftDegrees = 0.15
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const altitude = 500 + Math.sin(t * Math.PI) * 1500 + Math.sin(i * 1.7) * 20
    const angle = t * loops * 2 * Math.PI
    const lon = t * netDriftDegrees + Math.cos(angle) * thermalRadiusDegrees
    const lat = (t * netDriftDegrees) / 3 + Math.sin(angle) * thermalRadiusDegrees
    return point(i, Math.round(altitude), lon, lat)
  })
}

// Mirrors parse-track.ts:74's `seconds[index] ?? index` fallback (see check-barogram.mts
// for the same construction): once the known-seconds run out, secondsFromStart falls back
// to the raw index, which can dip below the last known value and produce duplicates.
function flightWithFallbackSeconds(count: number, knownSecondsCount: number): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const secondsFromStart = i < knownSecondsCount ? Math.floor(i / 2) * 3 : i
    const altitude = 500 + Math.sin((i / count) * Math.PI) * 1500
    return point(secondsFromStart, Math.round(altitude))
  })
}

// Independent oracle for nearestPointBySeconds: a brute-force linear scan, written
// separately from the binary-search implementation under test, so a bug in the binary
// search (e.g. picking the neighbour on the wrong side) has something real to disagree
// with instead of being checked against its own output.
function bruteForceNearestBySeconds(points: TrackPoint[], targetSeconds: number): TrackPoint | null {
  if (points.length === 0) return null
  let nearest = points[0]
  let nearestDistance = Math.abs(points[0].secondsFromStart - targetSeconds)
  for (const p of points) {
    const distance = Math.abs(p.secondsFromStart - targetSeconds)
    if (distance < nearestDistance) {
      nearest = p
      nearestDistance = distance
    }
  }
  return nearest
}

// Independent oracle for nearestIndexByLocation, same rationale as above, using a
// straightforward Euclidean scan over raw degrees rather than the implementation's
// latitude-weighted squared-distance loop. Valid as a ground truth only where cos(latitude)
// is close to 1 (this file's low-latitude syntheticFlight); the dedicated high-latitude
// fixture below uses true haversine distance instead, since at real flight latitudes the
// two metrics disagree by design.
function bruteForceNearestIndexByLocation(points: TrackPoint[], lon: number, lat: number): number | null {
  if (points.length === 0) return null
  let nearestIndex = 0
  let nearestDistance = Math.hypot(points[0].lon - lon, points[0].lat - lat)
  for (let i = 1; i < points.length; i++) {
    const distance = Math.hypot(points[i].lon - lon, points[i].lat - lat)
    if (distance < nearestDistance) {
      nearestIndex = i
      nearestDistance = distance
    }
  }
  return nearestIndex
}

// True haversine, written independently of altitude-color.ts's copy: the ground truth for
// the high-latitude self-crossing test below, where a plain (unweighted) degree distance is
// known to disagree with real-world proximity.
function haversineMetres(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const earthRadiusMetres = 6_371_000
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * earthRadiusMetres * Math.asin(Math.min(1, Math.sqrt(h)))
}

// --- xToSecondsFromStart: pinned at the plot edges and midpoint ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const scale = createAltitudeScale(flight, DEFAULT_CHART_BOUNDS)

  assertEqual(xToSecondsFromStart(scale, scale.bounds.paddingLeft), 0, 'left padding edge maps to second 0')
  assertEqual(
    xToSecondsFromStart(scale, scale.bounds.width - scale.bounds.paddingRight),
    scale.maxSeconds,
    'right padding edge maps to the last second',
  )
  const midX = scale.bounds.paddingLeft + (scale.bounds.width - scale.bounds.paddingLeft - scale.bounds.paddingRight) / 2
  assert(
    Math.abs(xToSecondsFromStart(scale, midX) - scale.maxSeconds / 2) < 1e-6,
    'the horizontal midpoint maps to half the flight duration',
  )
}

// --- xToSecondsFromStart: clamps a pointer outside the plot to the nearer end ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const scale = createAltitudeScale(flight, DEFAULT_CHART_BOUNDS)

  assertEqual(xToSecondsFromStart(scale, -500), 0, 'a pointer left of the plot clamps to second 0')
  assertEqual(
    xToSecondsFromStart(scale, scale.bounds.width + 500),
    scale.maxSeconds,
    'a pointer right of the plot clamps to the last second',
  )
}

// --- xToSecondsFromStart: a single-point (zero duration) series never divides by zero ---
{
  const scale = createAltitudeScale([point(0, 1000)], DEFAULT_CHART_BOUNDS)
  assert(scale.maxSeconds === 0, 'sanity: a single-point series has zero duration')
  assertEqual(xToSecondsFromStart(scale, 400), 0, 'any x on a zero-duration series resolves to second 0')
  assert(Number.isFinite(xToSecondsFromStart(scale, -50)), 'a zero-duration series stays finite off the left edge')
}

// --- nearestPointBySeconds: exact and between-point matches agree with a brute-force oracle ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const sorted = sortBySeconds(flight)
  for (const target of [0, 1, 2.4, 500.5, 3486, 3486.9, flight.length - 1]) {
    const actual = nearestPointBySeconds(sorted, target)
    const expected = bruteForceNearestBySeconds(flight, target)
    assertEqual(
      actual?.secondsFromStart,
      expected?.secondsFromStart,
      `nearest point at target seconds ${target} matches the brute-force oracle`,
    )
  }
}

// --- nearestPointBySeconds: a target before the first point clamps to the first point ---
{
  const sorted = sortBySeconds(syntheticFlight(500))
  assertEqual(nearestPointBySeconds(sorted, -1000)?.secondsFromStart, sorted[0].secondsFromStart, 'before the first point resolves to the first point')
}

// --- nearestPointBySeconds: a target after the last point clamps to the last point ---
{
  const sorted = sortBySeconds(syntheticFlight(500))
  const last = sorted[sorted.length - 1]
  assertEqual(nearestPointBySeconds(sorted, last.secondsFromStart + 10_000)?.secondsFromStart, last.secondsFromStart, 'after the last point resolves to the last point')
}

// --- nearestPointBySeconds: a single-point series always resolves to that point ---
{
  const sorted = sortBySeconds([point(42, 900)])
  assertEqual(nearestPointBySeconds(sorted, -100)?.secondsFromStart, 42, 'single-point series, query before it')
  assertEqual(nearestPointBySeconds(sorted, 42)?.secondsFromStart, 42, 'single-point series, exact query')
  assertEqual(nearestPointBySeconds(sorted, 9999)?.secondsFromStart, 42, 'single-point series, query after it')
}

// --- nearestPointBySeconds: an empty series resolves to null, not a throw ---
{
  assertEqual(nearestPointBySeconds([], 10), null, 'an empty series resolves to null')
}

// --- nearestPointBySeconds: the non-monotonic KML fallback tail still resolves correctly once sorted ---
{
  const flight = flightWithFallbackSeconds(REAL_FIXTURE_POINT_COUNT, 3000)
  const sorted = sortBySeconds(flight)

  let sortedAscending = true
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].secondsFromStart < sorted[i - 1].secondsFromStart) sortedAscending = false
  }
  assert(sortedAscending, 'sortBySeconds produces an ascending order even for the non-monotonic fallback tail')

  for (const target of [0, 1500, 4497, 3000, 6971]) {
    const actual = nearestPointBySeconds(sorted, target)
    const expected = bruteForceNearestBySeconds(flight, target)
    assertEqual(
      actual?.secondsFromStart,
      expected?.secondsFromStart,
      `fallback-tail track: nearest point at target seconds ${target} matches the brute-force oracle`,
    )
  }
}

// --- nearestIndexByLocation: matches a brute-force oracle across a real-shaped track ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  for (const [lon, lat] of [
    [0, 0],
    [0.15, 0.05],
    [0.1, 0.02],
    [0.05, 0.03],
    [-1, -1],
    [2, 2],
  ]) {
    const actual = nearestIndexByLocation(flight, lon, lat)
    const expected = bruteForceNearestIndexByLocation(flight, lon, lat)
    assertEqual(
      actual !== null ? [flight[actual].lon, flight[actual].lat] : null,
      expected !== null ? [flight[expected].lon, flight[expected].lat] : null,
      `nearest point to (${lon}, ${lat}) matches the brute-force oracle`,
    )
  }
}

// --- nearestIndexByLocation: a single point always wins, regardless of query position ---
{
  const single = [point(0, 900, 10, 20)]
  const found = nearestIndexByLocation(single, -50, 50)
  assertEqual(found !== null ? [single[found].lon, single[found].lat] : null, [10, 20], 'a single-point track resolves to that point from anywhere')
}

// --- nearestIndexByLocation: an empty track resolves to null, not a throw ---
{
  assertEqual(nearestIndexByLocation([], 0, 0), null, 'an empty track resolves to null')
}

// --- nearestIndexByLocation: duplicate coordinates (a stalled GPS fix) do not throw or return null ---
{
  const stalled = Array.from({ length: 20 }, (_, i) => point(i, 400 + i, 5, 5))
  const found = nearestIndexByLocation(stalled, 5, 5)
  assert(found !== null, 'a track with duplicate coordinates still resolves to a point')
}

// --- nearestIndexByLocation: latitude weighting picks the point that is actually nearer in
// the real world, not the one nearer in raw (unweighted) degrees. At the real fixture's
// ~62N latitude, a degree of longitude is worth only ~0.47 degrees of latitude in real
// distance; these two candidates are built so that ignoring that (an unweighted scan) picks
// the temporally distant point, and only the latitude-weighted comparison used in
// nearestIndexByLocation picks the truly nearer one. Confirmed against true haversine
// distance, an independent ground truth, not against the implementation's own metric. ---
{
  const highLatitude = 61.9
  const queryLon = 8.0
  const queryLat = highLatitude
  // Offset purely in longitude: 0.0015 degrees. Unweighted, this reads as farther than the
  // latitude-offset candidate below (0.0015 > 0.001); weighted by cos(61.9deg) ~= 0.4708, its
  // effective distance (0.000706 degrees-equivalent) reads as nearer.
  const lonOffsetCandidate = point(100, 500, queryLon + 0.0015, queryLat)
  // Offset purely in latitude: 0.001 degrees. Unweighted this is the nearer candidate;
  // latitude offsets are never weighted (weighting only ever discounts longitude), so this
  // candidate's real-world distance is exactly its raw degree offset either way.
  const latOffsetCandidate = point(5000, 500, queryLon, queryLat + 0.001)
  const flight = [lonOffsetCandidate, latOffsetCandidate]

  const trueNearestIndex =
    haversineMetres(lonOffsetCandidate, { lon: queryLon, lat: queryLat }) <
    haversineMetres(latOffsetCandidate, { lon: queryLon, lat: queryLat })
      ? 0
      : 1
  assertEqual(trueNearestIndex, 0, 'sanity: the longitude-offset candidate really is nearer in true (haversine) distance')

  const actualIndex = nearestIndexByLocation(flight, queryLon, queryLat)
  assertEqual(
    actualIndex,
    trueNearestIndex,
    'at high latitude, nearestIndexByLocation agrees with true distance, not raw (unweighted) degree distance',
  )
}

// --- indexByPoint: every point maps back to its own array position, by identity ---
{
  const flight = syntheticFlight(500)
  const indices = indexByPoint(flight)
  for (const i of [0, 1, 250, 499]) {
    assertEqual(indices.get(flight[i]), i, `indexByPoint maps flight[${i}] back to index ${i}`)
  }
}

// --- indexByPoint: distinguishes points that share a secondsFromStart value (the KML
// fallback-tail case), since it keys on object identity, not on secondsFromStart or any
// other field. This is the property the shared hover state (an index) depends on that
// secondsFromStart itself does not have (see track-hover.ts's module doc comment). ---
{
  const flight = flightWithFallbackSeconds(REAL_FIXTURE_POINT_COUNT, 3000)
  const duplicateSecondsValue = flight[10].secondsFromStart
  const duplicateIndices = flight.reduce<number[]>((acc, p, i) => (p.secondsFromStart === duplicateSecondsValue ? [...acc, i] : acc), [])
  assert(duplicateIndices.length > 1, 'sanity: the fallback-tail fixture really does repeat a secondsFromStart value')

  const indices = indexByPoint(flight)
  for (const i of duplicateIndices) {
    assertEqual(indices.get(flight[i]), i, `indexByPoint still maps index ${i} to itself despite a shared secondsFromStart value`)
  }
}

// --- the barogram's own translation pipeline (downsampled point -> nearest in time -> back
// to a full-track index, exactly as barogram.tsx composes these) round-trips exactly when a
// hovered point survives decimation, and stays close in elapsed time when it does not. This
// is the seam B2 was about: proving a full-track index survives the pipeline both views
// actually run, not just that each piece works in isolation. ---
{
  const full = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const sampled = downsampleByMinMax(full, DEFAULT_MAX_POINTS)
  const sortedSampled = sortBySeconds(sampled)
  const fullIndexOf = indexByPoint(full)

  for (const hoveredIndex of [0, 1234, Math.floor(full.length / 2), full.length - 1]) {
    const sourcePoint = full[hoveredIndex]
    const drawnPoint = nearestPointBySeconds(sortedSampled, sourcePoint.secondsFromStart)
    assert(drawnPoint !== null, `a hovered index at ${hoveredIndex} resolves to a drawable barogram point`)
    if (!drawnPoint) continue

    const resolvedFullIndex = fullIndexOf.get(drawnPoint)
    assert(resolvedFullIndex !== undefined, 'the drawn point translates back to a real full-track index')
    if (resolvedFullIndex === undefined) continue

    const elapsedGapSeconds = Math.abs(full[resolvedFullIndex].secondsFromStart - sourcePoint.secondsFromStart)
    assert(
      elapsedGapSeconds < 30,
      `hovering index ${hoveredIndex} draws a barogram point within 30s of elapsed time (actual gap ${elapsedGapSeconds}s)`,
    )

    if (sampled.includes(sourcePoint)) {
      assertEqual(resolvedFullIndex, hoveredIndex, `hovering a point that survived decimation (index ${hoveredIndex}) round-trips exactly`)
    }
  }
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
