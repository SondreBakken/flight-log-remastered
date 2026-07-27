import type { TrackPoint } from '../src/lib/flightlog/types'
import { altitudeColorRampCss, altitudeToColor, buildAltitudeGradient } from '../src/features/show-flight-track/altitude-color'
import { downsampleByMinMax } from '../src/features/show-flight-track/barogram-math'

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

// A synthetic climb-and-descent track that also spirals in space like a thermalling flight:
// a slow net drift (a glide) with 12 tight circling loops on top of it (thermals), rather
// than a straight line. This shape matters, not just realism for its own sake: on a straight
// line, cumulative distance and point index are proportional by construction, so a distance-
// based progress fraction and an index-based one are numerically IDENTICAL and no test built
// on a straight-line fixture can tell them apart. That is exactly how the real bug behind B1
// shipped undetected: it replaced full-track distance with decimated-set distance, and nothing
// in the old straight-line fixture could see the difference. On this spiral, the two diverge
// sharply (measured: total path length ~9.5x the net start-to-end displacement), so a
// regression back to index-based (or constant-distance) spacing is directly observable in the
// stop fractions below.
function syntheticFlight(count: number): TrackPoint[] {
  const loops = 12
  const thermalRadiusDegrees = 0.02
  const netDriftDegrees = 0.15
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    const altitude = 500 + Math.sin(t * Math.PI) * 1500 + Math.sin(i * 1.7) * 20
    const angle = t * loops * 2 * Math.PI
    const lon = t * netDriftDegrees + Math.cos(angle) * thermalRadiusDegrees
    const lat = t * netDriftDegrees / 3 + Math.sin(angle) * thermalRadiusDegrees
    return point(lon, lat, Math.round(altitude), i)
  })
}

function altitudesOf(points: TrackPoint[]): number[] {
  return points.map((p) => p.altitude)
}

function fractionDeltas(fractions: number[]): number[] {
  const deltas: number[] = []
  for (let i = 1; i < fractions.length; i++) deltas.push(fractions[i] - fractions[i - 1])
  return deltas
}

// Coefficient of variation of the gaps between consecutive stops. Used below as the signal
// that stop fractions were computed from real (non-uniform) distance, not from a uniform
// model (index spacing, or a constant per-step distance, which collapses to the same thing):
// on the spiral fixture, correct distance-based fractions measure CV ~0.7, while both of
// those broken models produce fractions that are uniform to within floating-point error
// (CV ~1e-15), regardless of the underlying track shape.
function coefficientOfVariation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.sqrt(variance) / mean
}

function isStrictlyIncreasingAndFinite(fractions: number[]): boolean {
  for (let i = 0; i < fractions.length; i++) {
    if (!Number.isFinite(fractions[i])) return false
    if (i > 0 && fractions[i] <= fractions[i - 1]) return false
  }
  return true
}

function parseRgbChannels(color: string): [number, number, number] {
  const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  if (!match) throw new Error(`not an rgb() colour: ${color}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

// HSL hue, used below to pin the colour ramp's ORIENTATION rather than just its endpoints.
function hueOf([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (delta === 0) return 0
  let hue: number
  if (max === r) hue = 60 * (((g - b) / delta) % 6)
  else if (max === g) hue = 60 * ((b - r) / delta + 2)
  else hue = 60 * ((r - g) / delta + 4)
  return hue < 0 ? hue + 360 : hue
}

// --- stops are strictly increasing and every fraction is finite (a NaN fraction is a
// `line-gradient` style error that drops the whole track line, and `NaN <= NaN` is false, so
// a strictly-increasing check alone reads an all-NaN stop set as valid) ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const { stops } = buildAltitudeGradient(flight)
  assert(
    isStrictlyIncreasingAndFinite(stops.map((s) => s.fraction)),
    'gradient stop fractions are all finite and strictly increasing',
  )
  assert(stops.length >= 2, 'a real track produces at least two stops')
}

// --- stop count is pinned to a concrete range, not the constant it would otherwise be
// tested against: hardcoded here so that changing the budget in the source (256 -> 4 or ->
// 2048) cannot silently keep this assertion passing by moving the goalposts with it ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const { stops } = buildAltitudeGradient(flight)
  assert(
    stops.length >= 250 && stops.length <= 256,
    `stop count for a ${REAL_FIXTURE_POINT_COUNT}-point track stays within the real 256-stop budget (got ${stops.length})`,
  )
  assert(stops.length < flight.length, 'stop count is smaller than the raw point count')
}

// --- stop fractions reflect real (non-uniform) distance along the FULL track, not the
// decimated stop sample and not raw point index: this is the B1 regression test. Both a
// uniform-index-spacing bug and a constant-per-step-distance bug (e.g. haversine replaced by
// a constant) collapse to the same signature — perfectly even gaps between stops — which the
// coefficient of variation below distinguishes from genuine distance-based spacing. ---
{
  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  const { stops } = buildAltitudeGradient(flight)
  const cv = coefficientOfVariation(fractionDeltas(stops.map((s) => s.fraction)))
  assert(
    cv > 0.1,
    `stop fractions are non-uniformly spaced (coefficient of variation ${cv.toFixed(3)} > 0.1), consistent with real distance rather than index order`,
  )
}

// --- stop fractions match an INDEPENDENT full-track distance oracle, point for point: the
// CV check above catches a collapse to uniform spacing, but not a subtler version of the
// same B1 bug where distance is still genuinely computed, just over the wrong (decimated)
// point set instead of the full one — that version is still non-uniform, so CV alone cannot
// tell it apart from correct. This recomputes the expected fraction for every surviving stop
// from a haversine implementation written separately from altitude-color.ts's (same rationale
// as check-track-hover.mts's brute-force oracles: an independent oracle has something real to
// disagree with), summed over the FULL point set, and compares it directly against what
// buildAltitudeGradient actually returned. ---
{
  function independentHaversineMetres(a: TrackPoint, b: TrackPoint): number {
    const earthRadiusMetres = 6_371_000
    const rad = (deg: number) => (deg * Math.PI) / 180
    const dLat = rad(b.lat - a.lat)
    const dLon = rad(b.lon - a.lon)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
    return 2 * earthRadiusMetres * Math.asin(Math.min(1, Math.sqrt(h)))
  }
  function independentFullTrackFractions(points: TrackPoint[]): number[] {
    const distances = [0]
    for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + independentHaversineMetres(points[i - 1], points[i]))
    const total = distances[distances.length - 1]
    return distances.map((d) => d / total)
  }

  const flight = syntheticFlight(REAL_FIXTURE_POINT_COUNT)
  // Mirrors buildAltitudeGradient's own default budget (256), hardcoded here rather than
  // imported so this oracle does not track a change to that constant.
  const sampled = downsampleByMinMax(flight, 256)
  const expectedFullFractions = independentFullTrackFractions(flight)
  const indexInFlight = new Map(flight.map((p, i) => [p, i]))
  const expectedStopFractions = sampled.map((p) => expectedFullFractions[indexInFlight.get(p)!])

  const { stops } = buildAltitudeGradient(flight, 256)
  assert(
    stops.length === expectedStopFractions.length,
    `sanity: no stops were dropped for this spiral fixture (${stops.length} stops, ${expectedStopFractions.length} sampled points), so a direct index comparison is valid`,
  )
  if (stops.length === expectedStopFractions.length) {
    let maxDeviation = 0
    for (let i = 0; i < stops.length; i++) {
      maxDeviation = Math.max(maxDeviation, Math.abs(stops[i].fraction - expectedStopFractions[i]))
    }
    assert(
      maxDeviation < 1e-6,
      `every stop fraction matches the independent full-track distance oracle (max deviation ${maxDeviation.toExponential(2)} < 1e-6)`,
    )
  }
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

// --- colour ramp is monotonic in hue across its whole span, not just at its endpoints: an
// endpoints-only check (lowBlue > lowRed, highRed > highBlue) is satisfied by amber too, so
// it misses a MID_ALTITUDE_COLOR / HIGH_ALTITUDE_COLOR swap. Sampling hue across the ramp
// and requiring it to move in one direction the whole way catches that swap, since a swap
// makes hue overshoot past the high anchor and come back, breaking monotonicity partway
// through rather than only at an endpoint. ---
{
  const min = 0
  const max = 1000
  const hues = Array.from({ length: 11 }, (_, i) => hueOf(parseRgbChannels(altitudeToColor(min + (i / 10) * (max - min), min, max))))
  let monotonic = true
  for (let i = 1; i < hues.length; i++) {
    if (hues[i] > hues[i - 1]) monotonic = false
  }
  assert(monotonic, 'colour hue decreases monotonically from the low-altitude anchor to the high-altitude anchor')
}

// --- clamp01's clamping behaviour is actually exercised: altitudeToColor is exported, so an
// out-of-range altitude (a caller passing a value outside [minAltitude, maxAltitude]) is a
// real, reachable input, not just an internal invariant. Without this, clamp01 has no test
// that fails if it is deleted. ---
{
  const min = 500
  const max = 1500
  assertEqual(
    altitudeToColor(min - 200, min, max),
    altitudeToColor(min, min, max),
    'an altitude below the range clamps to the low-altitude colour',
  )
  assertEqual(
    altitudeToColor(max + 200, min, max),
    altitudeToColor(max, min, max),
    'an altitude above the range clamps to the high-altitude colour',
  )
}

// --- the legend ramp CSS (altitudeColorRampCss) is covered directly, not only through
// altitudeToColor: it is the string AltitudeLegend actually renders, and had zero coverage,
// so reversing its colour order was undetected. ---
{
  const css = altitudeColorRampCss()
  assert(css.startsWith('linear-gradient(to right,'), 'the legend ramp is a left-to-right CSS gradient')
  const colors = [...css.matchAll(/rgb\(\d+,\s*\d+,\s*\d+\)/g)].map((m) => m[0])
  assertEqual(colors.length, 3, 'the legend ramp CSS carries exactly three colour stops')
  if (colors.length === 3) {
    const hues = colors.map((c) => hueOf(parseRgbChannels(c)))
    assert(
      hues[0] > hues[1] && hues[1] > hues[2],
      'the legend ramp reads the low-altitude colour first and the high-altitude colour last, in decreasing hue',
    )
  }
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
      assert(
        isStrictlyIncreasingAndFinite(gradient.stops.map((s) => s.fraction)),
        `a track with ${flight.length} point(s) still produces finite, strictly increasing stops`,
      )
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
    assert(
      isStrictlyIncreasingAndFinite(gradient.stops.map((s) => s.fraction)),
      'a track with zero total distance still produces finite, strictly increasing stops',
    )
  }
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
