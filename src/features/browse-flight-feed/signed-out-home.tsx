import { EmptyState } from '@/components/empty-state'
import { getRecentTrackedFlights } from '@/lib/flightlog/recent-public-flights'
import type { TakeoffFlight } from '@/lib/flightlog/types'
import { DiscoveryLinks } from './components/discovery-links'
import { PublicFlightRow } from './components/public-flight-row'

// What a signed-out visitor sees on `/`: recent Norway flights that have a GPS track, so the
// home page shows real content before anyone follows a pilot. A flightlog.org failure or a day
// with no tracked flights degrades to the discovery links alone, never an error: the links are
// the page's purpose when there is nothing to show.
export async function SignedOutHome({ defaultPilotId }: { defaultPilotId: number }) {
  const flights = await loadRecentFlights()

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Recent flights</h1>
      <p className="text-sm opacity-70">
        Recent flights in Norway that have a GPS track. Follow pilots to get their flights here.
      </p>
      {flights.length > 0 ? <RecentFlightsTable flights={flights} /> : <EmptyState>Recent flights are unavailable right now.</EmptyState>}
      <div className="flex flex-col gap-2 text-sm">
        <DiscoveryLinks defaultPilotId={defaultPilotId} />
      </div>
    </section>
  )
}

async function loadRecentFlights(): Promise<TakeoffFlight[]> {
  try {
    return await getRecentTrackedFlights()
  } catch (error) {
    console.error('SignedOutHome: could not load recent flights', error)
    return []
  }
}

function RecentFlightsTable({ flights }: { flights: TakeoffFlight[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule text-left">
            <th className="py-2 pr-4 form-label">Date</th>
            <th className="py-2 pr-4 form-label">Pilot</th>
            <th className="py-2 pr-4 text-right form-label">Time</th>
            <th className="py-2 pr-4 text-right form-label">Distance</th>
            <th className="py-2 form-label">Track</th>
          </tr>
        </thead>
        <tbody>
          {flights.map((flight) => (
            <PublicFlightRow key={flight.tripId} flight={flight} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
