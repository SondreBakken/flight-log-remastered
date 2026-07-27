import Link from 'next/link'
import { formatFlightDistance, formatFlightDuration } from '@/lib/flightlog/format-flight'
import type { FeedEntry } from '../feed'

type FeedEntryRowProps = {
  entry: FeedEntry
}

export function FeedEntryRow({ entry }: FeedEntryRowProps) {
  const { pilot, flight, hasTrack } = entry

  return (
    <tr className="border-b border-black/5 dark:border-white/10">
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{flight.date}</td>
      <td className="py-2 pr-4">
        <Link className="underline underline-offset-2" href={`/pilots/${pilot.userId}`}>
          {pilot.name}
        </Link>
      </td>
      <td className="py-2 pr-4">{flight.takeoff ?? '—'}</td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
        {formatFlightDuration(flight)}
      </td>
      <td className="py-2 pr-4 text-right whitespace-nowrap tabular-nums">
        {formatFlightDistance(flight)}
      </td>
      <td className="py-2">
        {hasTrack ? (
          <Link className="underline underline-offset-2" href={`/flights/${flight.tripId}`}>
            View track
          </Link>
        ) : (
          <span className="opacity-40">none</span>
        )}
      </td>
    </tr>
  )
}
