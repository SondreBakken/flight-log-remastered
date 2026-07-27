import type { ReactNode } from 'react'
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
} from './barogram-math'

type BarogramProps = {
  points: TrackPoint[]
}

const Y_TICK_COUNT = 4
const X_TICK_COUNT = 5

export function Barogram({ points }: BarogramProps) {
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
  const scale = createAltitudeScale(sampled, DEFAULT_CHART_BOUNDS)
  const path = buildAltitudePath(sampled, scale)
  const altitudeTicks = evenlySpacedValues(scale.minAltitude, scale.maxAltitude, Y_TICK_COUNT)
  const timeTicks = evenlySpacedValues(0, scale.maxSeconds, X_TICK_COUNT)

  return (
    <BarogramFrame>
      {/* Tick labels live in HTML, not the SVG: font-size inside a viewBox scales with
          the viewBox, so text sized to be legible on desktop shrinks to a few CSS px
          on a phone. Plain HTML text sits in real CSS pixels regardless of how far the
          SVG itself is scaled down, so one font size stays legible everywhere. */}
      <div className="relative w-full" style={aspectRatioStyle(scale.bounds)}>
        <svg
          viewBox={`0 0 ${scale.bounds.width} ${scale.bounds.height}`}
          className="absolute inset-0 h-full w-full text-black/70 dark:text-white/70"
          role="img"
          aria-label={describeAltitudeChart(scale)}
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
