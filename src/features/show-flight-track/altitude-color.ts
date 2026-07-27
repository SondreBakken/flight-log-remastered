import type { TrackPoint } from '@/lib/flightlog/types'
import { altitudeExtent, downsampleByMinMax } from './barogram-math'
import { TRACK_LINE_COLOR } from './colors'

export type GradientStop = {
  fraction: number
  color: string
}

export type AltitudeGradient = {
  stops: GradientStop[]
  minAltitude: number
  maxAltitude: number
}

// A raw track runs to ~7000 points and the map does not downsample the geometry itself,
// only the colour stops. `line-gradient` stops are listed individually in the style
// expression, so this bounds that list to an order of magnitude a human can perceive as a
// smooth ramp (a screen has nowhere near 7000 distinguishable pixels of line length)
// while staying far below where per-point stops would bloat the expression.
export const MAX_GRADIENT_STOPS = 256

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function toCssColor([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
}

function mixRgb(from: Rgb, to: Rgb, t: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ]
}

// The low end anchors on the barogram's line colour (see colors.ts) so the two views of
// a flight still read as related even though the map is now a ramp, not a flat line.
const LOW_ALTITUDE_COLOR: Rgb = hexToRgb(TRACK_LINE_COLOR)
const MID_ALTITUDE_COLOR: Rgb = [234, 179, 8] // amber-500
const HIGH_ALTITUDE_COLOR: Rgb = [220, 38, 38] // red-600

// Every internal caller passes an altitude already within [minAltitude, maxAltitude] (it
// comes from the same extent), so this never fires from inside this module. It stays as a
// contract guard on the exported function: any caller passing a slightly out-of-range value
// (e.g. floating-point drift) still gets a colour at the nearer end instead of an
// out-of-gamut mix. Covered directly in check-track-gradient.mts.
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function altitudeToColor(altitude: number, minAltitude: number, maxAltitude: number): string {
  // A flat profile (every point at the same altitude) has zero range: dividing by it
  // would produce NaN, so pin the whole track to the low end of the ramp instead.
  if (maxAltitude === minAltitude) return toCssColor(LOW_ALTITUDE_COLOR)

  const t = clamp01((altitude - minAltitude) / (maxAltitude - minAltitude))
  const rgb =
    t < 0.5 ? mixRgb(LOW_ALTITUDE_COLOR, MID_ALTITUDE_COLOR, t * 2) : mixRgb(MID_ALTITUDE_COLOR, HIGH_ALTITUDE_COLOR, (t - 0.5) * 2)
  return toCssColor(rgb)
}

export function altitudeColorRampCss(): string {
  return `linear-gradient(to right, ${toCssColor(LOW_ALTITUDE_COLOR)}, ${toCssColor(MID_ALTITUDE_COLOR)}, ${toCssColor(HIGH_ALTITUDE_COLOR)})`
}

const EARTH_RADIUS_METRES = 6_371_000

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function haversineDistanceMetres(a: TrackPoint, b: TrackPoint): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLon = toRadians(b.lon - a.lon)
  const lat1 = toRadians(a.lat)
  const lat2 = toRadians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Cumulative distance fractions approximate MapLibre's own `line-progress`, which is
// normalised cumulative distance along the RENDERED geometry: the full, undecimated point
// set (see track-map.tsx, which sources the line from `points` at full resolution). This
// must therefore run over that same full set, not the decimated stop sample: measured on a
// real ~7000-point thermalling track, running it over a 256-point decimation instead chords
// straight across every thermal circle and shortens the estimated path by 40%, displacing
// gradient stops by up to 9% of the track's length. Points repeated at the same coordinate
// (a stalled GPS fix) contribute zero distance, which is why the fractions coming out of
// this need the strictly-increasing filter below before they can be used as interpolate
// stops.
function progressFractions(points: TrackPoint[]): number[] {
  const distances = [0]
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + haversineDistanceMetres(points[i - 1], points[i]))
  }
  const total = distances[distances.length - 1]
  return total === 0 ? distances.map(() => 0) : distances.map((distance) => distance / total)
}

function keepStrictlyIncreasing(stops: GradientStop[]): GradientStop[] {
  const result: GradientStop[] = []
  for (const stop of stops) {
    const last = result[result.length - 1]
    if (last && stop.fraction <= last.fraction) continue
    result.push(stop)
  }
  return result
}

function solidGradient(color: string): GradientStop[] {
  return [
    { fraction: 0, color },
    { fraction: 1, color },
  ]
}

/**
 * Builds the colour ramp for a track's altitude, both the per-stop `line-gradient` input
 * and the extremes a legend needs to label it.
 *
 * The geometry itself stays at full point resolution (see track-map.tsx); only the STOP
 * SET is decimated here, via the same min/max-per-bucket downsampler the barogram uses, so
 * the highest and lowest points on the track usually survive to get their colour even
 * though most points in between are dropped (`keepStrictlyIncreasing` below can still drop
 * one of them if a stalled GPS fix collapses two stops onto the same fraction).
 *
 * Each stop's FRACTION, though, is looked up from progress computed over the full point
 * set (see progressFractions), not the decimated one, since that full set is what
 * `line-progress` is normalised against on the map. `downsampleByMinMax` returns references
 * into `points` rather than copies, so a point's position in the full array is recovered by
 * object identity via `indexByPoint`.
 *
 * `line-gradient`'s `interpolate` expression requires strictly increasing stop positions,
 * so duplicate or zero-distance fixes are filtered out after decimation. If that filtering
 * (or too few input points) leaves fewer than two stops, an expression can't be built from
 * real data at all, so this falls back to a two-stop solid ramp instead of throwing or
 * producing an invalid expression. Zero and one-point tracks take the same fallback path:
 * every stage above already degrades to it (an empty/singleton sample produces at most one
 * stop), so no separate early return is needed for them.
 */
export function buildAltitudeGradient(
  points: TrackPoint[],
  maxStops: number = MAX_GRADIENT_STOPS,
): AltitudeGradient {
  const { min: minAltitude, max: maxAltitude } = altitudeExtent(points)

  const sampled = downsampleByMinMax(points, maxStops)
  const fullFractions = progressFractions(points)
  const indexByPoint = new Map(points.map((point, index) => [point, index]))
  const stops = keepStrictlyIncreasing(
    sampled.map((point) => ({
      fraction: fullFractions[indexByPoint.get(point)!],
      color: altitudeToColor(point.altitude, minAltitude, maxAltitude),
    })),
  )

  if (stops.length >= 2) return { stops, minAltitude, maxAltitude }
  return { stops: solidGradient(stops[0]?.color ?? altitudeToColor(minAltitude, minAltitude, maxAltitude)), minAltitude, maxAltitude }
}
