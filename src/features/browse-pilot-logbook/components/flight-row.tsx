import Link from 'next/link'
import type { Flight } from '@/lib/flightlog/types'
import { formatFlightDistance, formatFlightDuration } from '@/lib/flightlog/format-flight'

type FlightRowProps = {
  flight: Flight
  hasTrack: boolean
}

export function FlightRow({ flight, hasTrack }: FlightRowProps) {
  return (
    <tr className="border-b border-black/5 dark:border-white/10">
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{flight.date}</td>
      {/* data-testid: scripts/verify-flown-sites.mts (F5) cross-checks the flown-sites
          section's own matched+unmatched count against the DISTINCT takeoff names this table
          renders independently — an under-reporting bug in the join would show up here as a
          disagreement between the two. */}
      <td className="py-2 pr-4" data-testid="flight-takeoff">{flight.takeoff ?? '—'}</td>
      <td className="py-2 pr-4 opacity-70">{flight.glider ?? '—'}</td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
        {formatFlightDuration(flight)}
      </td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
        {formatFlightDistance(flight)}
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
