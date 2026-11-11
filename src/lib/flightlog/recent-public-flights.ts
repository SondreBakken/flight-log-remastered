import 'server-only'
import { runWithConcurrencyLimit } from '@/lib/concurrency/with-limit'
import { CANDIDATE_LIMIT, getCountryFlights } from './country-flights'
import { hasTrack } from './tracks'
import type { TakeoffFlight } from './types'

// Norway, the one country the app curates (see CURATED_TAKEOFF_COUNTRY_IDS).
const NORWAY_COUNTRY_ID = 160
// Low on purpose: flightlog.org flags crawler-shaped traffic (docs/flightlog-api.md), and each
// uncached candidate is one rqtid=22 request.
const HAS_TRACK_CONCURRENCY = 4

// Of the country's newest CANDIDATE_LIMIT flights, those with a GPS track, newest first.
// A failed hasTrack check drops that one row; a failed list fetch propagates, since there is
// nothing to show without it.
export async function getRecentTrackedFlights(countryId = NORWAY_COUNTRY_ID): Promise<TakeoffFlight[]> {
  const candidates = (await getCountryFlights(countryId)).slice(0, CANDIDATE_LIMIT)
  const tracked = new Set<TakeoffFlight>()

  await runWithConcurrencyLimit(
    candidates,
    HAS_TRACK_CONCURRENCY,
    (flight) => hasTrack(flight.tripId),
    (flight, result) => {
      if (result.ok && result.value) tracked.add(flight)
    },
  )

  return candidates.filter((flight) => tracked.has(flight))
}
