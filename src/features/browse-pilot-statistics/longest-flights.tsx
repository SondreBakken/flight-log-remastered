'use client'

import type { KeyboardEvent, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import type { Flight } from '@/lib/flightlog/types'
import { formatFlightDistance, formatFlightDuration } from '@/lib/flightlog/format-flight'

type LongestFlightsListProps = {
  byDuration: Flight | null
  byDistance: Flight | null
}

// The byDuration/byDistance rows are the navigation target to /flights/{tripId} (#218),
// following #213's FlightRow pattern — neither row nests a link or button of its own, so
// onClick + a keyboard handler on the <li> itself is enough; no target-check guard needed
// (contrast #217/#222's rows, which nest a link and do need one). Split out as a client
// component for the same reason FlyingDaysCalendar was (#81): index.tsx's own PilotStatistics
// stays a server component, computing byDuration/byDistance and passing them down as the only
// serializable inputs this needs.
export function LongestFlightsList({ byDuration, byDistance }: LongestFlightsListProps) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {byDuration && (
        <LongestFlightRow flight={byDuration}>
          By duration (single-flight rows only): {formatFlightDuration(byDuration)} ({byDuration.date}
          {byDuration.takeoff && ` at ${byDuration.takeoff}`})
        </LongestFlightRow>
      )}
      {byDistance && (
        <LongestFlightRow flight={byDistance}>
          By distance: {formatFlightDistance(byDistance)} ({byDistance.date}
          {byDistance.takeoff && ` at ${byDistance.takeoff}`})
        </LongestFlightRow>
      )}
    </ul>
  )
}

function LongestFlightRow({ flight, children }: { flight: Flight; children: ReactNode }) {
  const router = useRouter()
  const href = `/flights/${flight.tripId}`

  function navigateToFlight() {
    router.push(href)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    navigateToFlight()
  }

  return (
    <li
      className="cursor-pointer rounded hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
      onClick={navigateToFlight}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      {children}
    </li>
  )
}
