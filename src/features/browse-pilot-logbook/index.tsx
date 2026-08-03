import Link from 'next/link'
import type { Flight, Pilot } from '@/lib/flightlog/types'
import { totalFlightCount } from '@/lib/flightlog/flight-count'
import { FollowButton } from '@/components/follow-button'
import { FlightRow } from './components/flight-row'

type PilotLogbookProps = {
  pilot: Pilot
  flights: Flight[]
  trackedTripIds: Set<number>
}

export default function PilotLogbook({ pilot, flights, trackedTripIds }: PilotLogbookProps) {
  return (
    <section className="flex flex-col gap-6">
      <PilotHeader
        pilot={pilot}
        flightCount={totalFlightCount(flights)}
        trackCount={trackedRowCount(flights, trackedTripIds)}
      />
      {flights.length === 0 ? <EmptyLogbook /> : (
        <FlightTable flights={flights} trackedTripIds={trackedTripIds} />
      )}
    </section>
  )
}

// The other half of the line counts TRACKS, and says so, because flightlog.org publishes no
// per-flight track relationship to say anything more precise. One tracklog exists per trip_id
// (rqtid=22 returns data_item_count 1), and an aggregated row's flights share that one id, so
// neither available number is a count of tracked flights: summing `flightCount` over-claims
// and one-per-row under-claims.
//
// Over-claiming is measured, not hypothetical. Pilot 9377's trip 802531 is the only
// aggregated-AND-tracked row found across 78 pilots of two clubs. Its row reads flightCount 2,
// its description reads "#11 og 12", and its tracklog is a single continuous descent from 279m
// to 83m followed by 135s stationary, with a largest continuous gain of 3.0m — GPS noise, not a
// second launch. Two flights in the entry, one flight in the track.
//
// Counting rows whose trip is tracked needs no inference: it is what the track index can
// actually answer.
function trackedRowCount(flights: Flight[], trackedTripIds: Set<number>): number {
  return flights.filter((flight) => trackedTripIds.has(flight.tripId)).length
}

function PilotHeader({
  pilot,
  flightCount,
  trackCount,
}: {
  pilot: Pilot
  flightCount: number
  trackCount: number
}) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{pilot.name}</h1>
        <span className="shrink-0 whitespace-nowrap">
          <FollowButton pilotId={pilot.userId} variant="prominent" />
        </span>
      </div>
      <p className="text-sm opacity-70">
        {[pilot.club, pilot.country].filter(Boolean).join(' · ')}
      </p>
      <p className="text-sm opacity-70">
        {flightCount} flights shown · {trackCount} GPS tracks
      </p>
    </header>
  )
}

function FlightTable({
  flights,
  trackedTripIds,
}: {
  flights: Flight[]
  trackedTripIds: Set<number>
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left dark:border-white/15">
            <th className="py-2 pr-4 font-medium">Date</th>
            <th className="py-2 pr-4 font-medium">Takeoff</th>
            <th className="py-2 pr-4 font-medium">Glider</th>
            <th className="py-2 pr-4 text-right font-medium">Time</th>
            <th className="py-2 pr-4 text-right font-medium">Distance</th>
            <th className="py-2 font-medium">Track</th>
          </tr>
        </thead>
        <tbody>
          {flights.map((flight) => (
            <FlightRow
              key={flight.tripId}
              flight={flight}
              hasTrack={trackedTripIds.has(flight.tripId)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyLogbook() {
  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      No flights found for this pilot.{' '}
      <Link className="underline" href="/">
        Back to your feed
      </Link>
    </p>
  )
}
