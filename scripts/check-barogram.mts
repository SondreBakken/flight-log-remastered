import assert from 'node:assert/strict'
import type { TrackPoint } from '../src/lib/flightlog/types'
import {
  DEFAULT_CHART_BOUNDS,
  buildAltitudePath,
  createAltitudeScale,
  downsampleByMinMax,
  evenlySpacedValues,
  formatElapsed,
} from '../src/features/show-flight-track/barogram-math'

function point(secondsFromStart: number, altitude: number): TrackPoint {
  return { lon: 0, lat: 0, altitude, secondsFromStart }
}

function syntheticFlight(count: number): TrackPoint[] {
  // A climb, a peak, and descent noise: the shape a barogram must preserve.
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const altitude = 500 + Math.sin(t * Math.PI) * 1500 + Math.sin(i * 1.7) * 20
    return point(i, Math.round(altitude))
  })
}

function altitudesOf(points: TrackPoint[]): number[] {
  return points.map((p) => p.altitude)
}

// --- downsampling preserves the series max and min ---
{
  const flight = syntheticFlight(7000)
  const originalMax = Math.max(...altitudesOf(flight))
  const originalMin = Math.min(...altitudesOf(flight))

  const sampled = downsampleByMinMax(flight, 400)
  const sampledMax = Math.max(...altitudesOf(sampled))
  const sampledMin = Math.min(...altitudesOf(sampled))

  assert.equal(sampledMax, originalMax, 'downsampling must preserve the series max altitude')
  assert.equal(sampledMin, originalMin, 'downsampling must preserve the series min altitude')
}

// --- downsampling reduces point count when the input exceeds the target ---
{
  const flight = syntheticFlight(7000)
  const sampled = downsampleByMinMax(flight, 400)
  assert.ok(sampled.length < flight.length, 'downsampled series must be smaller than the input')
  assert.ok(sampled.length <= 400 * 2, 'downsampled series must stay within roughly the target budget')
}

// --- downsampling is a no-op below the target ---
{
  const flight = syntheticFlight(50)
  const sampled = downsampleByMinMax(flight, 400)
  assert.equal(sampled.length, flight.length, 'a series under the target must pass through unchanged')
}

// --- downsampled points stay in chronological order ---
{
  const flight = syntheticFlight(7000)
  const sampled = downsampleByMinMax(flight, 400)
  for (let i = 1; i < sampled.length; i++) {
    assert.ok(
      sampled[i].secondsFromStart >= sampled[i - 1].secondsFromStart,
      'downsampled points must stay in chronological order',
    )
  }
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
  assert.deepEqual(evenlySpacedValues(10, 10, 4), [10, 10, 10, 10], 'a zero range must repeat the same value')
  assert.deepEqual(evenlySpacedValues(0, 100, 1), [0], 'a single tick returns just the minimum')
}

// --- formatElapsed reads as elapsed time, not a clock ---
{
  assert.equal(formatElapsed(0), '0m')
  assert.equal(formatElapsed(90), '2m')
  assert.equal(formatElapsed(3600), '1h00')
  assert.equal(formatElapsed(3660), '1h01')
}

console.log('check:barogram: all assertions passed')
