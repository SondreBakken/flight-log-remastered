import { describe, expect, it, vi } from 'vitest'

// Same reasoning as takeoff-detail.test.ts: mock 'server-only', next/cache, http.ts and
// parse-takeoff-flights.ts so this test exercises only takeoff-flights.ts's own contract.
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-takeoff-flights', () => ({ parseTakeoffFlights: vi.fn() }))

import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText } from './http'
import { parseTakeoffFlights } from './parse-takeoff-flights'
import { getTakeoffFlights } from './takeoff-flights'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParse = vi.mocked(parseTakeoffFlights)
const mockedCacheLife = vi.mocked(cacheLife)
const mockedCacheTag = vi.mocked(cacheTag)

describe('getTakeoffFlights', () => {
  it('requests a=42 for the given country/takeoff with no year param (current year, upstream default), caches hourly under the same per-takeoff tag getTakeoffDetail uses, and returns the parsed result', async () => {
    mockedFetch.mockResolvedValue('<html>flights stub</html>')
    mockedParse.mockReturnValue([
      {
        tripId: 1000946,
        userId: 3365,
        pilotName: 'Jarl Christian Kind',
        club: 'Pyongyang Freedom Fighters',
        glider: 'Gin Camino M',
        duration: '02:41',
        distanceKm: 28,
        note: null,
        date: '2026-07-17',
        timeOfDay: '10:52',
      },
    ])

    const flights = await getTakeoffFlights(160, 179)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=42&country_id=160&start_id=179', {
      referer: 'https://flightlog.org/fl.html?l=1&a=22&country_id=160&start_id=179',
    })
    expect(mockedParse).toHaveBeenCalledWith('<html>flights stub</html>', 179)
    expect(flights).toHaveLength(1)
    expect(mockedCacheLife).toHaveBeenCalledWith('hours')
    expect(mockedCacheTag).toHaveBeenCalledWith('takeoff-160-179')
  })

  it('keys the query string and the cache tag on the requested country/takeoff, not fixed ones', async () => {
    mockedFetch.mockResolvedValue('<html>stub</html>')
    mockedParse.mockReturnValue([])

    await getTakeoffFlights(29, 42)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=42&country_id=29&start_id=42', expect.anything())
    expect(mockedCacheTag).toHaveBeenCalledWith('takeoff-29-42')
  })

  // A plain passthrough, not a 404 decision of its own — see this module's own doc comment on
  // why page.tsx, not this function, is what decides whether a null here is an ordinary 404 or
  // an inconsistency worth throwing on.
  it('passes parseTakeoffFlights\' null straight through, without treating it as an error itself', async () => {
    mockedFetch.mockResolvedValue('<html>stub</html>')
    mockedParse.mockReturnValue(null)

    const flights = await getTakeoffFlights(160, 179)

    expect(mockedParse).toHaveBeenCalledWith('<html>stub</html>', 179)
    expect(flights).toBeNull()
  })
})
