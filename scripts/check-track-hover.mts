import type { TrackPoint } from '../src/lib/flightlog/types'
import {
  DEFAULT_CHART_BOUNDS,
  DEFAULT_MAX_POINTS,
  createAltitudeScale,
  downsampleByMinMax,
  xToSecondsFromStart,
} from '../src/features/show-flight-track/barogram-math'
import {
  nearestPointByLocation,
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

function syntheticFlight(count: number): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const altitude = 500 + Math.sin(t * Math.PI) * 1500 + Math.sin(i * 1.7) * 20
    // Moves in space too, at a rate matching check-track-gradient.mts's fixture, so
    // geographic nearest-point tests have real coordinates to work with.
    return point(i, Math.round(altitude), t * 0.5, t * 0.3)
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

// Independent oracle for nearestPointByLocation, same rationale as above, using a
// straightforward Euclidean scan rather than the implementation's squared-distance loop.
function bruteForceNearestByLocation(points: TrackPoint[], lon: number, lat: number): TrackPoint | null {
  if (points.length === 0) return null
  let nearest = points[0]
  let nearestDistance = Math.hypot(points[0].lon - lon, points[0].lat - lat)
  for (const p of points) {
    const distance = Math.hypot(p.lon - lon, p.lat - lat)
    if (distance < nearestDistance) {
      nearest = p
      nearestDistance = distance
    }
  }
  return nearest
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

// --- nearestPointByLocation: matches a brute-force oracle across a real-shaped track ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  for (const [lon, lat] of [
    [0, 0],
    [0.5, 0.3],
    [0.25, 0.15],
    [0.1, 0.28],
    [-1, -1],
    [2, 2],
  ]) {
    const actual = nearestPointByLocation(flight, lon, lat)
    const expected = bruteForceNearestByLocation(flight, lon, lat)
    assertEqual(
      [actual?.lon, actual?.lat],
      [expected?.lon, expected?.lat],
      `nearest point to (${lon}, ${lat}) matches the brute-force oracle`,
    )
  }
}

// --- nearestPointByLocation: a single point always wins, regardless of query position ---
{
  const single = [point(0, 900, 10, 20)]
  const found = nearestPointByLocation(single, -50, 50)
  assertEqual([found?.lon, found?.lat], [10, 20], 'a single-point track resolves to that point from anywhere')
}

// --- nearestPointByLocation: an empty track resolves to null, not a throw ---
{
  assertEqual(nearestPointByLocation([], 0, 0), null, 'an empty track resolves to null')
}

// --- nearestPointByLocation: duplicate coordinates (a stalled GPS fix) do not throw or return null ---
{
  const stalled = Array.from({ length: 20 }, (_, i) => point(i, 400 + i, 5, 5))
  const found = nearestPointByLocation(stalled, 5, 5)
  assert(!!found, 'a track with duplicate coordinates still resolves to a point')
}

// --- downsampled barogram set <-> full map track: resolving the same elapsed time in
// both sets independently agrees with the oracle, proving the two views can be driven by
// one shared `secondsFromStart` even though they never share an index space. ---
{
  const full = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const sampled = downsampleByMinMax(full, DEFAULT_MAX_POINTS)
  assert(sampled.length < full.length, 'sanity: the barogram set is smaller than the full track')

  const sortedFull = sortBySeconds(full)
  const sortedSampled = sortBySeconds(sampled)

  // Every point that survives downsampling is a real point from the full track (this
  // synthetic flight has secondsFromStart === index, so it is an exact-match round trip).
  for (const sampledPoint of [sampled[0], sampled[Math.floor(sampled.length / 2)], sampled[sampled.length - 1]]) {
    const resolvedInFull = nearestPointBySeconds(sortedFull, sampledPoint.secondsFromStart)
    const expected = bruteForceNearestBySeconds(full, sampledPoint.secondsFromStart)
    assertEqual(
      resolvedInFull?.secondsFromStart,
      expected?.secondsFromStart,
      `a downsampled-set point at ${sampledPoint.secondsFromStart}s resolves to the matching full-track point`,
    )
    assertEqual(
      resolvedInFull?.secondsFromStart,
      sampledPoint.secondsFromStart,
      `for this exact-seconds synthetic flight, the full-track match is an exact round trip`,
    )
  }

  // And the reverse: resolving a full-track point's time back against the downsampled set
  // lands on the nearest surviving sample, not necessarily an exact match.
  for (const fullPoint of [full[0], full[1234], full[full.length - 1]]) {
    const resolvedInSampled = nearestPointBySeconds(sortedSampled, fullPoint.secondsFromStart)
    const expected = bruteForceNearestBySeconds(sampled, fullPoint.secondsFromStart)
    assertEqual(
      resolvedInSampled?.secondsFromStart,
      expected?.secondsFromStart,
      `a full-track point at ${fullPoint.secondsFromStart}s resolves to the matching downsampled-set point`,
    )
  }
}

// --- downsampled <-> full mapping stays finite and non-null on the non-monotonic
// fallback tail too, matching an independent oracle rather than merely not throwing ---
{
  const full = flightWithFallbackSeconds(REAL_FIXTURE_POINT_COUNT, 3000)
  const sampled = downsampleByMinMax(full, DEFAULT_MAX_POINTS)
  const sortedFull = sortBySeconds(full)

  for (const sampledPoint of [sampled[0], sampled[Math.floor(sampled.length / 2)], sampled[sampled.length - 1]]) {
    const resolved = nearestPointBySeconds(sortedFull, sampledPoint.secondsFromStart)
    const expected = bruteForceNearestBySeconds(full, sampledPoint.secondsFromStart)
    assert(resolved !== null && Number.isFinite(resolved.secondsFromStart), 'fallback-tail mapping resolves to a finite point, not null/NaN')
    assertEqual(
      resolved?.secondsFromStart,
      expected?.secondsFromStart,
      `fallback-tail: downsampled-set point at ${sampledPoint.secondsFromStart}s matches the brute-force oracle in the full set`,
    )
  }
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
