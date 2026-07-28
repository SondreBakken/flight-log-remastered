import Link from 'next/link'
import type { Flight, Pilot } from '@/lib/flightlog/types'
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
        trackCount={trackedFlightCount(flights, trackedTripIds)}
      />
      {flights.length === 0 ? <EmptyLogbook /> : (
        <FlightTable flights={flights} trackedTripIds={trackedTripIds} />
      )}
    </section>
  )
}

// `flights.length` counts TABLE ROWS, not flights — a row aggregates same-day, same-glider
// flights (#68's `flightCount` field), so pilot 12677's four rows (flightCount 1, 2, 6, 1)
// are ten flights, not four (#70, confirmed against rqtid=1's own "Flights" column, which
// reports 10). Summing `flightCount` is what makes "N flights shown" true of the pilot's
// flying rather than of the table's row count.
function totalFlightCount(flights: Flight[]): number {
  return flights.reduce((total, flight) => total + flight.flightCount, 0)
}

// Same fix, same reasoning, for the OTHER half of the header line: `trackedTripIds.size`
// counts tracked ROWS, which undercounts identically once a tracked row is an aggregate.
// A GPS track is recorded per trip_id (rqtid=21/19, one continuous tracklog per trip), and an
// aggregated row's flights share that one trip_id — flightlog.org has no per-flight track
// breakdown to divide it by — so a tracked row's whole `flightCount` is honestly "covered by
// a GPS track", not just one flight of it. Fixing one half of the line and not the other
// would leave it stating two different units side by side with nothing announcing the switch.
function trackedFlightCount(flights: Flight[], trackedTripIds: Set<number>): number {
  return flights
    .filter((flight) => trackedTripIds.has(flight.tripId))
    .reduce((total, flight) => total + flight.flightCount, 0)
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
        Back to your feed
      </Link>
    </p>
  )
}
