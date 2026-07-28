import Link from 'next/link'
import type { TakeoffFlight } from '@/lib/flightlog/types'
import { FollowButton } from '@/components/follow-button'

type TakeoffFlightRowProps = {
  flight: TakeoffFlight
}

// Unconditional Link, no `hasTrack` check the way browse-pilot-logbook's FlightRow has one —
// #11's own scope note: `trip_id` is already in hand from the row's own a=34 link, and
// `/flights/[tripId]`'s `getTrack` takes that bare number directly, so this is a plain href,
// deliberately not a second fetch to confirm a track exists first.
export function TakeoffFlightRow({ flight }: TakeoffFlightRowProps) {
  return (
    <tr className="border-b border-black/5 dark:border-white/10">
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{flight.date ?? '—'}</td>
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{flight.timeOfDay ?? '—'}</td>
      <td className="py-2 pr-4">
        <div className="flex items-center gap-2">
          <Link className="underline underline-offset-2" href={`/pilots/${flight.userId}`}>
            {flight.pilotName}
          </Link>
          <FollowButton pilotId={flight.userId} variant="compact" />
        </div>
      </td>
      <td className="py-2 pr-4 opacity-70">{flight.club ?? '—'}</td>
      <td className="py-2 pr-4 opacity-70">{flight.glider ?? '—'}</td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">{flight.duration ?? '—'}</td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
        {flight.distanceKm === null ? '—' : `${flight.distanceKm.toFixed(1)} km`}
      </td>
      <td className="py-2 pr-4">{flight.note ?? '—'}</td>
      <td className="py-2">
        <Link className="underline underline-offset-2" href={`/flights/${flight.tripId}`}>
          View track
        </Link>
      </td>
    </tr>
  )
}
