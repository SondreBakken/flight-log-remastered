import assert from 'node:assert/strict'
import type { TrackPoint } from '../src/lib/flightlog/types'
import {
  DEFAULT_CHART_BOUNDS,
  DEFAULT_MAX_POINTS,
  buildAltitudePath,
  createAltitudeScale,
  describeAltitudeChart,
  downsampleByMinMax,
  evenlySpacedValues,
  formatElapsed,
} from '../src/features/show-flight-track/barogram-math'

function point(secondsFromStart: number, altitude: number): TrackPoint {
  return { lon: 0, lat: 0, altitude, secondsFromStart }
}

// 6972 is the real fixture's point count: not a multiple of the 200-bucket split, so
// bucket sizes vary by one and the remainder path that a round number like 7000 hides
// actually runs.
const REAL_FIXTURE_POINT_COUNT = 6972

function syntheticFlight(count: number): TrackPoint[] {
  // A climb, a peak, and descent noise: the shape a barogram must preserve.
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const altitude = 500 + Math.sin(t * Math.PI) * 1500 + Math.sin(i * 1.7) * 20
    return point(i, Math.round(altitude))
  })
}

// Mirrors parse-track.ts:72's `seconds[index] ?? index` fallback: when the raw KML
// seconds array is shorter than the coordinate list, trailing points fall back to their
// raw array index. Real timestamps run sparser than one-per-index, so the fallback both
// repeats values already used (duplicates) and drops back below them (non-monotonic).
function flightWithFallbackSeconds(count: number, knownSecondsCount: number): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const secondsFromStart = i < knownSecondsCount ? Math.floor(i / 2) * 3 : i
    const altitude = 500 + Math.sin((i / count) * Math.PI) * 1500
    return point(secondsFromStart, Math.round(altitude))
  })
}

function altitudesOf(points: TrackPoint[]): number[] {
  return points.map((p) => p.altitude)
}

// --- downsampling preserves the series max and min ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const originalMax = Math.max(...altitudesOf(flight))
  const originalMin = Math.min(...altitudesOf(flight))

  const sampled = downsampleByMinMax(flight, 400)
  const sampledMax = Math.max(...altitudesOf(sampled))
  const sampledMin = Math.min(...altitudesOf(sampled))

  assert.equal(sampledMax, originalMax, 'downsampling must preserve the series max altitude')
  assert.equal(sampledMin, originalMin, 'downsampling must preserve the series min altitude')
}

// --- downsampling reduces point count and stays within the real point budget ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const sampled = downsampleByMinMax(flight, 400)
  assert.ok(sampled.length < flight.length, 'downsampled series must be smaller than the input')
  // bucketCount = floor(maxPoints / 2) buckets, at most 2 points each: the real
  // contract is `<= maxPoints`, not some looser multiple of it. A budget-doubling bug
  // (e.g. using maxPoints directly as the bucket count) must fail this.
  assert.ok(
    sampled.length <= DEFAULT_MAX_POINTS,
    `downsampled series must stay within the ${DEFAULT_MAX_POINTS}-point budget`,
  )
}

// --- downsampling is a no-op below the target ---
{
  const flight = syntheticFlight(50)
  const sampled = downsampleByMinMax(flight, 400)
  assert.equal(sampled.length, flight.length, 'a series under the target must pass through unchanged')
}

// --- downsampled points stay in chronological order ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const sampled = downsampleByMinMax(flight, 400)
  for (let i = 1; i < sampled.length; i++) {
    assert.ok(
      sampled[i].secondsFromStart >= sampled[i - 1].secondsFromStart,
      'downsampled points must stay in chronological order',
    )
  }
}

// --- downsampling copes with the non-monotonic, duplicated seconds the KML fallback can produce ---
{
  const flight = flightWithFallbackSeconds(REAL_FIXTURE_POINT_COUNT, 3000)
  const originalMax = Math.max(...altitudesOf(flight))
  const originalMin = Math.min(...altitudesOf(flight))

  const sampled = downsampleByMinMax(flight, 400)
  assert.ok(sampled.length > 0, 'a fallback-seconds series must still downsample to something')
  assert.equal(
    Math.max(...altitudesOf(sampled)),
    originalMax,
    'altitude extremes must survive even when secondsFromStart is not monotonic',
  )
  assert.equal(
    Math.min(...altitudesOf(sampled)),
    originalMin,
    'altitude extremes must survive even when secondsFromStart is not monotonic',
  )

  const scale = createAltitudeScale(sampled, DEFAULT_CHART_BOUNDS)
  const path = buildAltitudePath(sampled, scale)
  assert.ok(
    path.split(' ').every((token) => token === 'M' || token === 'L' || Number.isFinite(Number(token))),
    'a fallback-seconds series must still produce a well-formed, finite path',
  )
}

// --- bucket coverage is complete: no bucket may silently drop its last index ---
{
  // Strictly increasing altitude makes every bucket's min its first point and its max
  // its last, so the extremes selected per bucket are pinned to specific indices. With
  // pointCount=25 and maxPoints=21, bucketCount is 10 and bucketSize is 2.5, which
  // splits into a mix of size-2 and size-3 buckets. A bucket-end off-by-one
  // (`Math.floor((i+1)*bucketSize) - 1`) shrinks every non-final bucket by one index,
  // collapsing the size-2 buckets from a min/max pair down to a single point and
  // silently losing the dropped index from every bucket entirely. A range assertion on
  // the output length can't see this (both cases produce "fewer points than input"), so
  // this pins the exact count a correct, coverage-complete split must produce.
  const pointCount = 25
  const maxPoints = 21
  const flight = Array.from({ length: pointCount }, (_, i) => point(i, i))
  const sampled = downsampleByMinMax(flight, maxPoints)
  assert.equal(
    sampled.length,
    20,
    'every bucket must contribute its full min/max pair; a dropped last index changes this count',
  )
}

// --- y axis is pinned: higher altitude must map to a smaller y (SVG y grows downward) ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const scale = createAltitudeScale(flight, DEFAULT_CHART_BOUNDS)
  assert.equal(
    scale.y(scale.maxAltitude),
    scale.bounds.paddingTop,
    'the highest altitude must sit exactly at the top padding edge',
  )
  assert.equal(
    scale.y(scale.minAltitude),
    scale.bounds.height - scale.bounds.paddingBottom,
    'the lowest altitude must sit exactly at the bottom padding edge',
  )
  assert.ok(
    scale.y(scale.maxAltitude) < scale.y(scale.minAltitude),
    'higher altitude must map to a smaller y than lower altitude',
  )
}

// --- x axis is pinned: time runs left to right ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const scale = createAltitudeScale(flight, DEFAULT_CHART_BOUNDS)
  assert.equal(scale.x(0), scale.bounds.paddingLeft, 'time zero must sit exactly at the left edge')
  assert.equal(
    scale.x(scale.maxSeconds),
    scale.bounds.width - scale.bounds.paddingRight,
    'the last second must sit exactly at the right edge',
  )
}

// --- scaling a flat altitude profile does not divide by zero ---
{
  const flat = [point(0, 1000), point(60, 1000), point(120, 1000)]
  const scale = createAltitudeScale(flat, DEFAULT_CHART_BOUNDS)
  for (const p of flat) {
    const y = scale.y(p.altitude)
    assert.ok(Number.isFinite(y), 'y-scale must produce a finite value for a flat profile')
  }
}

// --- scaling a single-point series does not divide by zero ---
{
  const scale = createAltitudeScale([point(0, 1200)], DEFAULT_CHART_BOUNDS)
  assert.ok(Number.isFinite(scale.y(1200)), 'y-scale must handle a single-point series')
  assert.ok(Number.isFinite(scale.x(0)), 'x-scale must handle a single-point series')
}

// --- zero-point and one-point inputs do not throw ---
{
  assert.doesNotThrow(() => {
    const scale = createAltitudeScale([], DEFAULT_CHART_BOUNDS)
    buildAltitudePath([], scale)
    downsampleByMinMax([], 400)
  }, 'an empty track must not throw')

  assert.doesNotThrow(() => {
    const single = [point(0, 800)]
    const scale = createAltitudeScale(single, DEFAULT_CHART_BOUNDS)
    buildAltitudePath(single, scale)
    downsampleByMinMax(single, 400)
  }, 'a single-point track must not throw')
}

// --- the generated path string is well formed ---
{
  const flight = syntheticFlight(500)
  const sampled = downsampleByMinMax(flight, 400)
  const scale = createAltitudeScale(sampled, DEFAULT_CHART_BOUNDS)
  const path = buildAltitudePath(sampled, scale)

  assert.ok(path.startsWith('M '), 'path must open with a moveto command')
  assert.equal((path.match(/M /g) ?? []).length, 1, 'path must contain exactly one moveto')
  assert.ok(/^[ML0-9.\- ]+$/.test(path), 'path must only contain M/L commands and numbers')

  const numbers = path
    .replace(/[ML]/g, '')
    .trim()
    .split(/\s+/)
    .map(Number)
  assert.ok(
    numbers.every((n) => Number.isFinite(n)),
    'every coordinate in the path must be a finite number',
  )
}

// --- the empty path is the empty string, not a malformed command ---
{
  const scale = createAltitudeScale([], DEFAULT_CHART_BOUNDS)
  assert.equal(buildAltitudePath([], scale), '')
}

// --- evenlySpacedValues degenerate cases ---
{
  assert.deepEqual(
    evenlySpacedValues(10, 10, 4),
    [10],
    'a zero range must collapse to a single tick, not repeat duplicates',
  )
  assert.deepEqual(evenlySpacedValues(0, 100, 1), [0], 'a single tick returns just the minimum')
  assert.deepEqual(
    evenlySpacedValues(0, 100, 5),
    [0, 25, 50, 75, 100],
    'a real range must still produce evenly spaced, distinct ticks',
  )
}

// --- formatElapsed reads as elapsed time, not a clock ---
{
  assert.equal(formatElapsed(0), '0m')
  assert.equal(formatElapsed(90), '2m')
  assert.equal(formatElapsed(3600), '1h00')
  assert.equal(formatElapsed(3660), '1h01')
}

// --- describeAltitudeChart folds the figures a sighted user reads off the axes into the accessible name ---
{
  const label = describeAltitudeChart({ minAltitude: 360, maxAltitude: 2657, maxSeconds: 3660 })
  assert.match(label, /360/, 'accessible name must include the min altitude')
  assert.match(label, /2657/, 'accessible name must include the max altitude')
  assert.match(label, /1h01/, 'accessible name must include the flight duration')
}

console.log('check:barogram: all assertions passed')
