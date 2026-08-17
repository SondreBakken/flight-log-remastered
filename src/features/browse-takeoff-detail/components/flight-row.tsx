'use client'

import type { KeyboardEvent, MouseEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { TakeoffFlight } from '@/lib/flightlog/types'
import { FollowButton } from '@/components/follow-button'

type TakeoffFlightRowProps = {
  flight: TakeoffFlight
  isFollowed: boolean
  isSignedIn: boolean
}

// The whole row is the navigation target (#213, ported by #219), not just the Track cell —
// unconditional Link, no `hasTrack` check the way browse-pilot-logbook's FlightRow has one:
// #11's own scope note, `trip_id` is already in hand from the row's own a=34 link, and
// `/flights/[tripId]`'s `getTrack` takes that bare number directly, so this row always has
// somewhere to go. This row has TWO nested interactive elements in the pilot cell (the pilot
// Link and FollowButton, which itself renders either a Link or a button) — unlike
// feed-entry-row.tsx's single nested Link, FollowButton has no onClick prop to hook
// stopPropagation into individually, so propagation is stopped on the wrapping div around both
// instead. The target check in handleKeyDown generalizes the same way feed-entry-row.tsx's does.
export function TakeoffFlightRow({ flight, isFollowed, isSignedIn }: TakeoffFlightRowProps) {
  const router = useRouter()
  const href = `/flights/${flight.tripId}`

  function navigateToFlight() {
    router.push(href)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    navigateToFlight()
  }

  function stopRowNavigation(event: MouseEvent<HTMLDivElement>) {
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
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{flight.date ?? '—'}</td>
      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">{flight.timeOfDay ?? '—'}</td>
      <td className="py-2 pr-4">
        <div className="flex items-center gap-2" onClick={stopRowNavigation}>
          <Link className="underline underline-offset-2" href={`/pilots/${flight.userId}`}>
            {flight.pilotName}
          </Link>
          <FollowButton isFollowed={isFollowed} isSignedIn={isSignedIn} pilotId={flight.userId} variant="compact" />
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
        <span>View track</span>
      </td>
    </tr>
  )
}
