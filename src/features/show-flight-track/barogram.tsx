import type { TrackPoint } from '@/lib/flightlog/types'
import {
  type AltitudeScale,
  DEFAULT_CHART_BOUNDS,
  DEFAULT_MAX_POINTS,
  buildAltitudePath,
  createAltitudeScale,
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
  if (points.length === 0) return <EmptyBarogram />

  const sampled = downsampleByMinMax(points, DEFAULT_MAX_POINTS)
  const scale = createAltitudeScale(sampled, DEFAULT_CHART_BOUNDS)
  const path = buildAltitudePath(sampled, scale)
  const altitudeTicks = evenlySpacedValues(scale.minAltitude, scale.maxAltitude, Y_TICK_COUNT)
  const timeTicks = evenlySpacedValues(0, scale.maxSeconds, X_TICK_COUNT)

  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-sm font-medium opacity-70">Altitude</h2>
      <svg
        viewBox={`0 0 ${scale.bounds.width} ${scale.bounds.height}`}
        className="w-full text-black/70 dark:text-white/70"
        role="img"
        aria-label="Altitude over elapsed time"
      >
        <AltitudeAxis ticks={altitudeTicks} scale={scale} />
        <TimeAxis ticks={timeTicks} scale={scale} />
        <path
          d={path}
          fill="none"
          stroke="#2563eb"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  )
}

function AltitudeAxis({ ticks, scale }: { ticks: number[]; scale: AltitudeScale }) {
  return (
    <g>
      {ticks.map((altitude) => (
        <g key={altitude}>
          <line
            x1={scale.bounds.paddingLeft}
            x2={scale.bounds.width - scale.bounds.paddingRight}
            y1={scale.y(altitude)}
            y2={scale.y(altitude)}
            className="stroke-black/10 dark:stroke-white/10"
          />
          <text
            x={scale.bounds.paddingLeft - 6}
            y={scale.y(altitude)}
            dominantBaseline="middle"
            textAnchor="end"
            className="fill-current text-[10px] tabular-nums"
          >
            {Math.round(altitude)} m
          </text>
        </g>
      ))}
    </g>
  )
}

function TimeAxis({ ticks, scale }: { ticks: number[]; scale: AltitudeScale }) {
  return (
    <g>
      {ticks.map((seconds) => (
        <text
          key={seconds}
          x={scale.x(seconds)}
          y={scale.bounds.height - scale.bounds.paddingBottom + 14}
          textAnchor="middle"
          className="fill-current text-[10px] tabular-nums"
        >
          {formatElapsed(seconds)}
        </text>
      ))}
    </g>
  )
}

function EmptyBarogram() {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-sm font-medium opacity-70">Altitude</h2>
      <div className="flex h-[220px] w-full items-center justify-center rounded-md border border-dashed border-black/15 text-sm opacity-60 dark:border-white/20">
        No track points
      </div>
    </div>
  )
}
