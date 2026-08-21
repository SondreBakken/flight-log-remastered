'use client'

import type { KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { Flight } from '@/lib/flightlog/types'
import { formatFlightDistance, formatFlightDuration } from '@/lib/flightlog/format-flight'

type FlightRowProps = {
  flight: Flight
  hasTrack: boolean
}

// The whole row is the navigation target (#213), not just the Track cell — most flights have
// no track, so a link confined to that cell left most rows with no way to reach their flight
// page (and its comments) at all. A `<tr>` can't be an `<a>`, so this is onClick + a keyboard
// handler rather than a real link; no cell below carries its own link/button, which is what
// keeps this from becoming an interactive element nested inside a clickable row.
//
// No role="button" here (#233, same fix as #221/#231 on the feed-entry-row and
// browse-takeoff-detail flight-row siblings): ARIA prohibits role="button" on a <tr>, since it
// strips the row's implicit row semantics and orphans its <td> children for assistive tech.
// aria-label gives screen-reader users the same "this row is actionable" signal instead.
export function FlightRow({ flight, hasTrack }: FlightRowProps) {
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

  return (
    <tr
      aria-label="View flight details"
      className="cursor-pointer border-b border-black/5 hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.03]"
      onClick={navigateToFlight}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
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
        {hasTrack ? <span>View track</span> : <span className="opacity-40">none</span>}
      </td>
    </tr>
  )
}
