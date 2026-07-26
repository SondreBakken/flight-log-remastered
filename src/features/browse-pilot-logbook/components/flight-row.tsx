import Link from 'next/link'
import type { Flight } from '@/lib/flightlog/types'

type FlightRowProps = {
  flight: Flight
  hasTrack: boolean
}

function formatDistance(flight: Flight): string {
  const distance = flight.distanceKm ?? flight.openDistanceKm
  return distance === null ? '—' : `${distance.toFixed(1)} km`
}

function formatDuration(flight: Flight): string {
  if (flight.duration === null) return '—'
  return flight.flightCount > 1
    ? `${flight.duration} (${flight.flightCount})`
    : flight.duration
}

export function FlightRow({ flight, hasTrack }: FlightRowProps) {
  return (
    <tr className="border-b border-black/5 dark:border-white/10">
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{flight.date}</td>
      <td className="py-2 pr-4">{flight.takeoff ?? '—'}</td>
      <td className="py-2 pr-4 opacity-70">{flight.glider ?? '—'}</td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
        {formatDuration(flight)}
      </td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
        {formatDistance(flight)}
      </td>
      <td className="py-2">
        {hasTrack ? (
          <Link
            className="underline underline-offset-2"
            href={`/flights/${flight.tripId}`}
          >
            View track
          </Link>
        ) : (
          <span className="opacity-40">none</span>
        )}
      </td>
    </tr>
  )
}
