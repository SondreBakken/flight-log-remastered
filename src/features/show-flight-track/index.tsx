import type { ReactNode } from 'react'
import { CalendarDate } from '@/components/calendar-date'
import type { Track, TrackPoint, TrackStats, TrackStatsResult } from '@/lib/flightlog/types'
import { formatTrackDuration } from '@/lib/flightlog/format-flight'
import { formatAltitude } from './format-altitude'
import { formatMaxSpeed } from './format-max-speed'
import { TrackHoverView } from './track-hover-view'

type FlightTrackProps = {
  track: Track
}

type Stat = { label: string; value: ReactNode }

function isTrackStats(result: TrackStatsResult): result is TrackStats {
  return result !== 'unparseable'
}

// The shared null placeholder, taken from formatAltitude so every stat renders absence alike.
const NULL_PLACEHOLDER = formatAltitude(null)

function toStats(stats: TrackStats, points: TrackPoint[]): Stat[] {
  return [
    { label: 'Date', value: stats.date === null ? NULL_PLACEHOLDER : <CalendarDate value={stats.date} /> },
    { label: 'Start / finish', value: stats.startFinish ?? NULL_PLACEHOLDER },
    { label: 'Duration', value: formatTrackDuration(stats.duration) ?? NULL_PLACEHOLDER },
    { label: 'Max altitude', value: formatAltitude(stats.maxAltitude) },
    { label: 'Min altitude', value: formatAltitude(stats.minAltitude) },
    { label: 'Max speed', value: formatMaxSpeed(stats.maxSpeed, stats.maxSpeedKind) },
    { label: 'Max climb', value: stats.maxClimb ?? NULL_PLACEHOLDER },
    { label: 'Min climb', value: stats.minClimb ?? NULL_PLACEHOLDER },
    { label: 'Track points', value: points.length.toLocaleString('en') },
  ]
}

export default function FlightTrack({ track }: FlightTrackProps) {
  return (
    <div className="flex flex-col gap-6">
      {isTrackStats(track.stats) && <SummaryRow stats={track.stats} />}
      <TrackHoverView points={track.points} scoring={track.scoring} />
      {isTrackStats(track.stats) ? (
        <StatGrid stats={toStats(track.stats, track.points)} />
      ) : (
        <StatsUnavailable />
      )}
    </div>
  )
}

function SummaryRow({ stats }: { stats: TrackStats }) {
  return (
    <StatList
      stats={[
        { label: 'Duration', value: formatTrackDuration(stats.duration) ?? NULL_PLACEHOLDER },
        { label: 'Max altitude', value: formatAltitude(stats.maxAltitude) },
      ]}
      className="flex gap-x-8 text-base"
      testId="flight-summary-row"
    />
  )
}

function StatsUnavailable() {
  return (
    <p className="text-sm opacity-70" data-testid="stats-unparseable">
      Could not read the statistics for this flight.
    </p>
  )
}

function StatGrid({ stats }: { stats: Stat[] }) {
  return <StatList stats={stats} className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3" testId="stat-grid" />
}

function StatList({ stats, className, testId }: { stats: Stat[]; className: string; testId?: string }) {
  return (
    <dl className={className} data-testid={testId}>
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col">
          <dt className="opacity-60">{stat.label}</dt>
          <dd className="tabular-nums">{stat.value}</dd>
        </div>
      ))}
    </dl>
  )
}
