import type { TrackPoint } from '@/lib/flightlog/types'

export type ChartBounds = {
  width: number
  height: number
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
}

export type AltitudeScale = {
  bounds: ChartBounds
  minAltitude: number
  maxAltitude: number
  maxSeconds: number
  x: (secondsFromStart: number) => number
  y: (altitude: number) => number
}

export const DEFAULT_CHART_BOUNDS: ChartBounds = {
  width: 800,
  height: 220,
  paddingTop: 12,
  paddingRight: 12,
  paddingBottom: 24,
  paddingLeft: 44,
}

// 1 Hz tracks run to ~7000 points for a 2 hour flight; a few hundred on-screen
// pixels of width is already more detail than an SVG line can show.
export const DEFAULT_MAX_POINTS = 400

function bucketRanges(pointCount: number, bucketCount: number): Array<[number, number]> {
  const bucketSize = pointCount / bucketCount
  return Array.from({ length: bucketCount }, (_, index) => {
    const start = Math.floor(index * bucketSize)
    const end = index === bucketCount - 1 ? pointCount : Math.floor((index + 1) * bucketSize)
    return [start, end]
  })
}

function minMaxInRange(points: TrackPoint[], [start, end]: [number, number]): TrackPoint[] {
  let min = points[start]
  let max = points[start]
  for (let i = start + 1; i < end; i++) {
    const point = points[i]
    if (point.altitude < min.altitude) min = point
    if (point.altitude > max.altitude) max = point
  }
  if (min === max) return [min]
  return min.secondsFromStart <= max.secondsFromStart ? [min, max] : [max, min]
}

/**
 * Min/max-per-bucket downsampling: split the series into evenly sized buckets and keep
 * only the highest and lowest point of each. Chosen over naive every-Nth-point sampling
 * because a bucket's max/min is exactly the series max/min wherever that extreme falls,
 * so climbs and the flight ceiling always survive, and it needs no per-point scoring
 * pass (unlike largest-triangle-three-buckets), which fits a single altitude trace fine.
 */
export function downsampleByMinMax(points: TrackPoint[], maxPoints: number): TrackPoint[] {
  if (points.length <= maxPoints) return points

  const bucketCount = Math.max(1, Math.floor(maxPoints / 2))
  return bucketRanges(points.length, bucketCount).flatMap((range) => minMaxInRange(points, range))
}

function altitudeExtent(points: TrackPoint[]): { min: number; max: number } {
  if (points.length === 0) return { min: 0, max: 0 }
  const altitudes = points.map((point) => point.altitude)
  return { min: Math.min(...altitudes), max: Math.max(...altitudes) }
}

function maxSecondsFromStart(points: TrackPoint[]): number {
  if (points.length === 0) return 0
  return Math.max(...points.map((point) => point.secondsFromStart))
}

export function createAltitudeScale(
  points: TrackPoint[],
  bounds: ChartBounds = DEFAULT_CHART_BOUNDS,
): AltitudeScale {
  const { min: minAltitude, max: maxAltitude } = altitudeExtent(points)
  const maxSeconds = maxSecondsFromStart(points)

  const plotWidth = bounds.width - bounds.paddingLeft - bounds.paddingRight
  const plotHeight = bounds.height - bounds.paddingTop - bounds.paddingBottom

  // A flat (or single-point) profile has zero altitude range. Fall back to a fixed
  // span centred on that altitude so the line draws mid-chart instead of dividing by zero.
  const isFlat = maxAltitude === minAltitude
  const altitudeSpan = isFlat ? 1 : maxAltitude - minAltitude
  const altitudeFloor = isFlat ? minAltitude - altitudeSpan / 2 : minAltitude
  const timeSpan = maxSeconds || 1

  return {
    bounds,
    minAltitude,
    maxAltitude,
    maxSeconds,
    x: (secondsFromStart) => bounds.paddingLeft + (secondsFromStart / timeSpan) * plotWidth,
    y: (altitude) =>
      bounds.paddingTop + plotHeight - ((altitude - altitudeFloor) / altitudeSpan) * plotHeight,
  }
}

export function buildAltitudePath(points: TrackPoint[], scale: AltitudeScale): string {
  if (points.length === 0) return ''

  const segments = points.map((point, index) => {
    const command = index === 0 ? 'M' : 'L'
    return `${command} ${scale.x(point.secondsFromStart).toFixed(2)} ${scale.y(point.altitude).toFixed(2)}`
  })
  return segments.join(' ')
}

export function evenlySpacedValues(min: number, max: number, count: number): number[] {
  if (count <= 1) return [min]
  const step = (max - min) / (count - 1)
  return Array.from({ length: count }, (_, index) => min + step * index)
}

export function formatElapsed(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : `${minutes}m`
}
