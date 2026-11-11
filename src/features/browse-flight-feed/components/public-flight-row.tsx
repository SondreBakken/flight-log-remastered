import Link from 'next/link'
import { CalendarDate } from '@/components/calendar-date'
import type { TakeoffFlight } from '@/lib/flightlog/types'

// Server-rendered, so plain links instead of FeedEntryRow's whole-row click target (which needs
// useRouter): a signed-out visitor has no follows or newness to show either.
export function PublicFlightRow({ flight }: { flight: TakeoffFlight }) {
  return (
    <tr className="border-b border-rule">
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
        {flight.date === null ? '-' : <CalendarDate value={flight.date} />}
      </td>
      <td className="py-2 pr-4">
        <Link href={`/pilots/${flight.userId}`}>
          {flight.pilotName}
        </Link>
      </td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">{flight.duration ?? '-'}</td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
        {flight.distanceKm === null ? '-' : `${flight.distanceKm.toFixed(1)} km`}
      </td>
      <td className="py-2">
        <Link href={`/flights/${flight.tripId}`}>
          View track
        </Link>
      </td>
    </tr>
  )
}
