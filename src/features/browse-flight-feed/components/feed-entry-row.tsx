'use client'

import type { KeyboardEvent, MouseEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatFlightDistance, formatFlightDuration } from '@/lib/flightlog/format-flight'
import type { FeedEntry } from '../feed'

type FeedEntryRowProps = {
  entry: FeedEntry
}

// The whole row is the navigation target (#213, ported by #217), not just a Track cell — most
// flights have no track, so a link confined to that cell left most rows with no way to reach
// their flight page at all. Unlike flight-row.tsx's sibling, this row does have a nested
// interactive element (the pilot link below), so its click must stop propagation to avoid also
// triggering row navigation.
export function FeedEntryRow({ entry }: FeedEntryRowProps) {
  const { pilot, flight, hasTrack, newness } = entry
  const router = useRouter()
  const href = `/flights/${flight.tripId}`

  function navigateToFlight() {
    router.push(href)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    navigateToFlight()
  }

  function stopRowNavigation(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation()
  }

  return (
    <tr
      className="cursor-pointer border-b border-black/5 hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.03]"
      onClick={navigateToFlight}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
        {newness === 'new' && (
          // Positive-only signal, deliberately: 'not-new' renders with no badge here, tracked
          // or untracked alike (see feed.ts's FlightNewness — both are fully classifiable now,
          // #62). A "seen before" badge for 'not-new' would be pure noise on an already-quiet
          // row; the "New" badge alone carries the entire signal this table needs to show.
          <span className="mr-1.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
            New
          </span>
        )}
        {flight.date}
      </td>
      <td className="py-2 pr-4">
        <Link
          className="underline underline-offset-2"
          href={`/pilots/${pilot.userId}`}
          onClick={stopRowNavigation}
        >
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
      <td className="py-2">{hasTrack ? <span>View track</span> : <span className="opacity-40">none</span>}</td>
    </tr>
  )
}
