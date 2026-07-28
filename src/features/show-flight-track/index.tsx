import type { Track } from '@/lib/flightlog/types'
import { formatAltitude } from './format-altitude'
import { TrackHoverView } from './track-hover-view'

type FlightTrackProps = {
  track: Track
}

type Stat = { label: string; value: string }

function toStats(track: Track): Stat[] {
  const { stats, points } = track
  return [
    { label: 'Date', value: stats.date ?? '—' },
    { label: 'Start / finish', value: stats.startFinish ?? '—' },
    { label: 'Duration', value: stats.duration ?? '—' },
    { label: 'Max altitude', value: formatAltitude(stats.maxAltitude) },
    { label: 'Min altitude', value: formatAltitude(stats.minAltitude) },
    { label: 'Max speed', value: stats.maxSpeed ?? '—' },
    { label: 'Max climb', value: stats.maxClimb ?? '—' },
    { label: 'Min climb', value: stats.minClimb ?? '—' },
    { label: 'Track points', value: points.length.toLocaleString('en') },
  ]
}

export default function FlightTrack({ track }: FlightTrackProps) {
  return (
    <div className="flex flex-col gap-6">
      <TrackHoverView points={track.points} scoring={track.scoring} />
      <StatGrid stats={toStats(track)} />
    </div>
  )
}

function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col">
          <dt className="opacity-60">{stat.label}</dt>
          <dd className="tabular-nums">{stat.value}</dd>
        </div>
      ))}
    </dl>
  )
}
