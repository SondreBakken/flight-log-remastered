import type { TrackPoint } from '../src/lib/flightlog/types'
import {
  MAX_GRADIENT_STOPS,
  altitudeToColor,
  buildAltitudeGradient,
} from '../src/features/show-flight-track/altitude-color'

let failures = 0

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'ok' : 'FAIL'} - ${label}`)
  if (!pass) {
    failures++
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

function point(lon: number, lat: number, altitude: number, secondsFromStart: number): TrackPoint {
  return { lon, lat, altitude, secondsFromStart }
}

// 6972 is the real fixture's point count, chosen elsewhere in this repo (check-barogram.mts)
// specifically because it is not a multiple of the bucket split, so the remainder path
// actually runs. Reused here for the same reason.
const REAL_FIXTURE_POINT_COUNT = 6972

// A synthetic climb-and-descent track that also moves in space, so cumulative distance is
// nonzero and progress fractions are meaningful (unlike the same-coordinate case below).
function syntheticFlight(count: number): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const altitude = 500 + Math.sin(t * Math.PI) * 1500 + Math.sin(i * 1.7) * 20
    // ~1e-4 degrees/point keeps consecutive points distinct without any point revisiting
    // a prior coordinate, so distance climbs monotonically across the whole track.
    return point(t * 0.5, t * 0.3, Math.round(altitude), i)
  })
}

function altitudesOf(points: TrackPoint[]): number[] {
  return points.map((p) => p.altitude)
}

// --- stops are strictly increasing ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const { stops } = buildAltitudeGradient(flight)
  let increasing = true
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].fraction <= stops[i - 1].fraction) increasing = false
  }
  assert(increasing, 'gradient stop fractions are strictly increasing')
  assert(stops.length >= 2, 'a real track produces at least two stops')
}

// --- stop count stays bounded regardless of the raw point count ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const { stops } = buildAltitudeGradient(flight)
  assert(
    stops.length <= MAX_GRADIENT_STOPS,
    `stop count stays within the ${MAX_GRADIENT_STOPS}-stop budget for a ${REAL_FIXTURE_POINT_COUNT}-point track`,
  )
  assert(stops.length < flight.length, 'stop count is smaller than the raw point count')
}

// --- altitude extremes survive decimation ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const originalMax = Math.max(...altitudesOf(flight))
  const originalMin = Math.min(...altitudesOf(flight))
  const gradient = buildAltitudeGradient(flight)

  assertEqual(gradient.maxAltitude, originalMax, 'gradient.maxAltitude matches the series max')
  assertEqual(gradient.minAltitude, originalMin, 'gradient.minAltitude matches the series min')

  const stopColors = new Set(gradient.stops.map((s) => s.color))
  assert(
    stopColors.has(altitudeToColor(originalMax, originalMin, originalMax)),
    'the highest point still gets the high-altitude colour after decimation',
  )
  assert(
    stopColors.has(altitudeToColor(originalMin, originalMin, originalMax)),
    'the lowest point still gets the low-altitude colour after decimation',
  )
}

// --- colour at the low end and the high end ---
{
  const min = 300
  const max = 2600
  const low = altitudeToColor(min, min, max)
  const mid = altitudeToColor((min + max) / 2, min, max)
  const high = altitudeToColor(max, min, max)
  assert(low !== high, 'low-altitude colour differs from high-altitude colour')
  assert(low !== mid && mid !== high, 'the midpoint colour differs from both ends of the ramp')
}

// --- colour scale orientation is pinned to the ramp's actual anchor colours (blue-ish
// low, red-ish high), independent of altitudeToColor itself: computing both the "actual"
// and "expected" colour through the same (possibly mutated) function under test would let
// a low/high swap mutation slip through undetected, since both sides would swap together.
// Reading the raw RGB channels back out of the CSS string sidesteps that. ---
{
  function parseRgbChannels(color: string): [number, number, number] {
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    if (!match) throw new Error(`not an rgb() colour: ${color}`)
    return [Number(match[1]), Number(match[2]), Number(match[3])]
  }

  const [lowRed, , lowBlue] = parseRgbChannels(altitudeToColor(0, 0, 1000))
  const [highRed, , highBlue] = parseRgbChannels(altitudeToColor(1000, 0, 1000))
  assert(lowBlue > lowRed, 'the low-altitude colour is more blue than red')
  assert(highRed > highBlue, 'the high-altitude colour is more red than blue')
}

// --- colour scale orientation: low altitude and high altitude never land on the same colour ---
{
  const min = 0
  const max = 1000
  const colors = [0, 250, 500, 750, 1000].map((altitude) => altitudeToColor(altitude, min, max))
  assertEqual(new Set(colors).size, colors.length, 'five altitudes spanning the range each get a distinct colour')
}

// --- degenerate: every point at the same altitude (zero range) does not throw or produce NaN ---
{
  const flat = Array.from({ length: 50 }, (_, i) => point(i * 0.001, 0, 1000, i))
  let threw = false
  let gradient
  try {
    gradient = buildAltitudeGradient(flat)
  } catch {
    threw = true
  }
  assert(!threw, 'a flat altitude profile does not throw')
  assert(!!gradient && gradient.stops.every((s) => Number.isFinite(s.fraction)), 'a flat altitude profile produces finite stop fractions')
  // A divide-by-zero in the colour scale doesn't throw in JS, it produces NaN channels,
  // which Number.isFinite/typeof checks alone don't catch: `rgb(NaN, NaN, NaN)` is a
  // non-empty string like any other. Requiring the CSS value to be all-digit rgb()
  // channels is what actually catches that.
  assert(
    !!gradient && gradient.stops.every((s) => /^rgb\(\d+, \d+, \d+\)$/.test(s.color)),
    'a flat altitude profile still produces a well-formed, finite colour (not rgb(NaN, NaN, NaN)) for every stop',
  )
}

// --- degenerate: fewer than two points does not throw ---
{
  for (const flight of [[], [point(10, 60, 500, 0)]]) {
    let threw = false
    let gradient
    try {
      gradient = buildAltitudeGradient(flight)
    } catch {
      threw = true
    }
    assert(!threw, `a track with ${flight.length} point(s) does not throw`)
    assert(!!gradient && gradient.stops.length >= 2, `a track with ${flight.length} point(s) still produces a valid (>=2 stop) gradient`)
    if (gradient) {
      let increasing = true
      for (let i = 1; i < gradient.stops.length; i++) {
        if (gradient.stops[i].fraction <= gradient.stops[i - 1].fraction) increasing = false
      }
      assert(increasing, `a track with ${flight.length} point(s) still produces strictly increasing stops`)
    }
  }
}

// --- degenerate: every point at the same coordinate (zero total distance) does not throw ---
{
  const stationary = Array.from({ length: 200 }, (_, i) => point(10, 60, 400 + (i % 20) * 50, i))
  let threw = false
  let gradient
  try {
    gradient = buildAltitudeGradient(stationary)
  } catch {
    threw = true
  }
  assert(!threw, 'a track with zero total distance does not throw')
  assert(!!gradient && gradient.stops.length >= 2, 'a track with zero total distance still produces a valid (>=2 stop) gradient')
  if (gradient) {
    let increasing = true
    for (let i = 1; i < gradient.stops.length; i++) {
      if (gradient.stops[i].fraction <= gradient.stops[i - 1].fraction) increasing = false
    }
    assert(increasing, 'a track with zero total distance still produces strictly increasing stops')
  }
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
