import Link from 'next/link'
import type { Flight, Pilot } from '@/lib/flightlog/types'
import { FlightRow } from './components/flight-row'

type PilotLogbookProps = {
  pilot: Pilot
  flights: Flight[]
  trackedTripIds: Set<number>
}

export default function PilotLogbook({ pilot, flights, trackedTripIds }: PilotLogbookProps) {
  return (
    <section className="flex flex-col gap-6">
      <PilotHeader pilot={pilot} flightCount={flights.length} trackCount={trackedTripIds.size} />
      {flights.length === 0 ? <EmptyLogbook /> : (
        <FlightTable flights={flights} trackedTripIds={trackedTripIds} />
      )}
    </section>
  )
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
      <h1 className="text-2xl font-semibold tracking-tight">{pilot.name}</h1>
      <p className="text-sm opacity-70">
        {[pilot.club, pilot.country].filter(Boolean).join(' · ')}
      </p>
      <p className="text-sm opacity-70">
        {flightCount} flights shown · {trackCount} with a GPS track
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
        Back to the default pilot
      </Link>
    </p>
  )
}
