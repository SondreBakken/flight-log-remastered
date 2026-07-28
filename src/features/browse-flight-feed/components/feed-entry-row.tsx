import Link from 'next/link'
import { formatFlightDistance, formatFlightDuration } from '@/lib/flightlog/format-flight'
import type { FeedEntry } from '../feed'

type FeedEntryRowProps = {
  entry: FeedEntry
}

export function FeedEntryRow({ entry }: FeedEntryRowProps) {
  const { pilot, flight, hasTrack, newness } = entry

  return (
    <tr className="border-b border-black/5 dark:border-white/10">
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
        {newness === 'new' && (
          // Positive-only signal, deliberately: 'not-new' and 'unknown' (untracked, so
          // newness could not be checked at all — see feed.ts's FlightNewness) both render
          // with no badge here. Rendering a distinct "not new" state for 'not-new' would
          // require rendering SOME state for 'unknown' too, and there is no honest one —
          // "we don't know" has no positive badge that isn't itself a claim.
          <span className="mr-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
            New
          </span>
        )}
        {flight.date}
      </td>
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
