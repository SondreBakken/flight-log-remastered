import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { useMemo, useRef } from 'react'
import type { TrackPoint } from '@/lib/flightlog/types'
import { TRACK_LINE_COLOR } from './colors'
import {
  type AltitudeScale,
  type ChartBounds,
  DEFAULT_CHART_BOUNDS,
  DEFAULT_MAX_POINTS,
  buildAltitudePath,
  createAltitudeScale,
  describeAltitudeChart,
  downsampleByMinMax,
  evenlySpacedValues,
  formatElapsed,
  xToSecondsFromStart,
} from './barogram-math'
import { formatAltitude } from './format-altitude'
import { indexByPoint, nearestPointBySeconds, sortBySeconds } from './track-hover'

type BarogramProps = {
  points: TrackPoint[]
  hoveredIndex: number | null
  onHoverIndex: (index: number | null) => void
}

const Y_TICK_COUNT = 4
const X_TICK_COUNT = 5
// One key press covers ~5% of the plotted series either way, so PageUp/PageDown cross a
// ~400-point chart in ~20 presses instead of ArrowLeft/Right's ~400.
const COARSE_STEP = 20

/** ARIA slider stepping: Home/End jump to the ends, PageUp/PageDown take a coarse step. */
function stepIndex(key: string, currentIndex: number, length: number): number | null {
  const clamp = (index: number) => Math.min(length - 1, Math.max(0, index))
  switch (key) {
    case 'ArrowRight':
      return clamp(currentIndex + 1)
    case 'ArrowLeft':
      return clamp(currentIndex - 1)
    case 'PageDown':
      return clamp(currentIndex + COARSE_STEP)
    case 'PageUp':
      return clamp(currentIndex - COARSE_STEP)
    case 'Home':
      return 0
    case 'End':
      return length - 1
    default:
      return null
  }
}

export function Barogram({ points, hoveredIndex, onHoverIndex }: BarogramProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  // Built once per `points` identity rather than per render: this is a scan over the full
  // ~7000-point track, and both pointer moves and keystrokes need it every time they fire.
  const fullIndexOf = useMemo(() => indexByPoint(points), [points])

  if (points.length === 0) {
    return (
      <BarogramFrame>
        <div
          className="flex w-full items-center justify-center rounded-md border border-dashed border-black/15 text-sm opacity-60 dark:border-white/20"
          style={aspectRatioStyle(DEFAULT_CHART_BOUNDS)}
        >
          No track points
        </div>
      </BarogramFrame>
    )
  }

  const sampled = downsampleByMinMax(points, DEFAULT_MAX_POINTS)
  const sorted = sortBySeconds(sampled)
  const scale = createAltitudeScale(sampled, DEFAULT_CHART_BOUNDS)
  const path = buildAltitudePath(sampled, scale)
  const altitudeTicks = evenlySpacedValues(scale.minAltitude, scale.maxAltitude, Y_TICK_COUNT)
  const timeTicks = evenlySpacedValues(0, scale.maxSeconds, X_TICK_COUNT)
  // hoveredIndex is a position in the full track (see track-hover.ts); this chart can only
  // ever draw one of its own `sampled` points, so the point actually drawn is the nearest
  // survivor in time, not necessarily hoveredIndex's own point.
  const hoveredSourcePoint = hoveredIndex === null ? null : (points[hoveredIndex] ?? null)
  const hoveredPoint = hoveredSourcePoint ? nearestPointBySeconds(sorted, hoveredSourcePoint.secondsFromStart) : null

  function indexAtClientX(clientX: number): number | null {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const localX = ((clientX - rect.left) / rect.width) * scale.bounds.width
    const point = nearestPointBySeconds(sorted, xToSecondsFromStart(scale, localX))
    return point ? (fullIndexOf.get(point) ?? null) : null
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const index = indexAtClientX(event.clientX)
    if (index !== null) onHoverIndex(index)
  }

  function handlePointerLeave() {
    onHoverIndex(null)
  }

  function handleKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    const currentSortedIndex = hoveredPoint ? sorted.indexOf(hoveredPoint) : -1
    const nextSortedIndex = stepIndex(event.key, currentSortedIndex, sorted.length)
    if (nextSortedIndex === null) return
    event.preventDefault()
    const fullIndex = fullIndexOf.get(sorted[nextSortedIndex])
    if (fullIndex !== undefined) onHoverIndex(fullIndex)
  }

  const valueText = hoveredPoint
    ? `${formatElapsed(hoveredPoint.secondsFromStart)} elapsed, ${formatAltitude(hoveredPoint.altitude)}`
    : 'No point selected'

  return (
    <BarogramFrame>
      {/* Tick labels live in HTML, not the SVG: font-size inside a viewBox scales with
          the viewBox, so text sized to be legible on desktop shrinks to a few CSS px
          on a phone. Plain HTML text sits in real CSS pixels regardless of how far the
          SVG itself is scaled down, so one font size stays legible everywhere. */}
      <div className="relative w-full" style={aspectRatioStyle(scale.bounds)}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${scale.bounds.width} ${scale.bounds.height}`}
          className="absolute inset-0 h-full w-full touch-none text-black/70 dark:text-white/70"
          role="slider"
          aria-label={describeAltitudeChart(scale)}
          aria-valuemin={0}
          aria-valuemax={scale.maxSeconds}
          aria-valuenow={hoveredPoint ? hoveredPoint.secondsFromStart : 0}
          aria-valuetext={valueText}
          tabIndex={0}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          onKeyDown={handleKeyDown}
        >
          <AltitudeGridlines ticks={altitudeTicks} scale={scale} />
          <path
            d={path}
            fill="none"
            stroke={TRACK_LINE_COLOR}
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {hoveredPoint && (
            <HoverIndicator point={hoveredPoint} scale={scale} fullIndex={fullIndexOf.get(hoveredPoint) ?? null} />
          )}
        </svg>
        {/* The SVG's aria-label already carries the range and duration, so these
            overlay labels would only repeat that content for assistive tech. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <AltitudeLabels ticks={altitudeTicks} scale={scale} />
          <TimeLabels ticks={timeTicks} scale={scale} />
        </div>
      </div>
    </BarogramFrame>
  )
}

function HoverIndicator({
  point,
  scale,
  fullIndex,
}: {
  point: TrackPoint
  scale: AltitudeScale
  fullIndex: number | null
}) {
  const x = scale.x(point.secondsFromStart)
  const y = scale.y(point.altitude)
  const plotTop = scale.bounds.paddingTop
  const plotBottom = scale.bounds.height - scale.bounds.paddingBottom

  return (
    <g
      data-testid="barogram-hover-indicator"
      data-seconds={point.secondsFromStart}
      data-altitude={point.altitude}
      data-index={fullIndex ?? ''}
    >
      <line
        x1={x}
        x2={x}
        y1={plotTop}
        y2={plotBottom}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        className="stroke-black/30 dark:stroke-white/30"
      />
      <circle cx={x} cy={y} r={4} strokeWidth={2} className="fill-white stroke-black dark:fill-black dark:stroke-white" />
    </g>
  )
}

function aspectRatioStyle(bounds: ChartBounds): { aspectRatio: string } {
  return { aspectRatio: `${bounds.width} / ${bounds.height}` }
}

function BarogramFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-sm font-medium opacity-70">Altitude</h2>
      {children}
    </div>
  )
}

function AltitudeGridlines({ ticks, scale }: { ticks: number[]; scale: AltitudeScale }) {
  return (
    <g>
      {ticks.map((altitude) => (
        <line
          key={altitude}
          x1={scale.bounds.paddingLeft}
          x2={scale.bounds.width - scale.bounds.paddingRight}
          y1={scale.y(altitude)}
          y2={scale.y(altitude)}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className="stroke-black/10 dark:stroke-white/10"
        />
      ))}
    </g>
  )
}

function AltitudeLabels({ ticks, scale }: { ticks: number[]; scale: AltitudeScale }) {
  const labelWidthPercent = (scale.bounds.paddingLeft / scale.bounds.width) * 100
  return (
    <>
      {ticks.map((altitude) => (
        <span
          key={altitude}
          className="absolute -translate-y-1/2 pr-1.5 text-right text-[11px] whitespace-nowrap tabular-nums opacity-70"
          style={{
            top: `${(scale.y(altitude) / scale.bounds.height) * 100}%`,
            left: 0,
            width: `${labelWidthPercent}%`,
          }}
        >
          {Math.round(altitude)} m
        </span>
      ))}
    </>
  )
}

function TimeLabels({ ticks, scale }: { ticks: number[]; scale: AltitudeScale }) {
  return (
    <>
      {ticks.map((seconds) => (
        <span
          key={seconds}
          className="absolute -translate-x-1/2 text-[11px] tabular-nums opacity-70"
          style={{
            top: `${((scale.bounds.height - scale.bounds.paddingBottom + 8) / scale.bounds.height) * 100}%`,
            left: `${(scale.x(seconds) / scale.bounds.width) * 100}%`,
          }}
        >
          {formatElapsed(seconds)}
        </span>
      ))}
    </>
  )
}
