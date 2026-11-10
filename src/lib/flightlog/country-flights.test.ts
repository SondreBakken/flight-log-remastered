import { beforeEach, describe, expect, it, vi } from 'vitest'

// Same mock pattern as takeoff-flights.test.ts: only country-flights.ts's own contract runs.
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-country-flights', () => ({ parseCountryFlights: vi.fn(), parseCountryFlightDays: vi.fn() }))

import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText } from './http'
import { parseCountryFlightDays, parseCountryFlights } from './parse-country-flights'
import { CANDIDATE_LIMIT, getCountryFlights } from './country-flights'
import type { TakeoffFlight } from './types'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParse = vi.mocked(parseCountryFlights)
const mockedDays = vi.mocked(parseCountryFlightDays)

function flightsOn(date: string, firstTripId: number, count: number): TakeoffFlight[] {
  return Array.from({ length: count }, (_, i) => ({
    tripId: firstTripId + i,
    userId: 1,
    pilotName: 'Pilot',
    club: null,
    glider: null,
    duration: '00:10',
    distanceKm: null,
    note: null,
    date,
    timeOfDay: null,
  }))
}

const REFERER = 'https://flightlog.org/fl.html?l=1&a=48&country_id=160'

describe('getCountryFlights', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedFetch.mockImplementation(async (path) => `html for ${path}`)
  })

  it('fetches only the bare page when it already holds CANDIDATE_LIMIT rows, caching hourly under the global tag', async () => {
    mockedParse.mockReturnValue(flightsOn('2026-11-10', 100, CANDIDATE_LIMIT))

    const flights = await getCountryFlights(160)

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=47&country_id=160', { referer: REFERER })
    expect(flights).toHaveLength(CANDIDATE_LIMIT)
    expect(cacheLife).toHaveBeenCalledWith('hours')
    expect(cacheTag).toHaveBeenCalledWith('recent-flights')
  })

  it('tops a short bare page up with the newest earlier day, newest first', async () => {
    mockedParse.mockReturnValueOnce(flightsOn('2026-11-10', 100, 1)).mockReturnValueOnce(flightsOn('2026-11-09', 200, 3))
    mockedDays.mockReturnValue(['2026-11-10', '2026-11-09', '2026-11-08'])

    const flights = await getCountryFlights(160)

    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(mockedFetch).toHaveBeenLastCalledWith(
      '/fl.html?l=1&a=47&country_id=160&year=2026&tripdate=2026-11-09',
      { referer: REFERER },
    )
    expect(flights.map((flight) => flight.tripId)).toEqual([100, 200, 201, 202])
  })

  it('fetches the first index day when the bare page has no rows', async () => {
    mockedParse.mockReturnValueOnce([]).mockReturnValueOnce(flightsOn('2026-11-09', 200, 2))
    mockedDays.mockReturnValue(['2026-11-09', '2026-11-08'])

    await getCountryFlights(160)

    expect(mockedFetch).toHaveBeenLastCalledWith(
      '/fl.html?l=1&a=47&country_id=160&year=2026&tripdate=2026-11-09',
      expect.anything(),
    )
  })

  it('returns the short bare list when the index holds no earlier day', async () => {
    mockedParse.mockReturnValue(flightsOn('2026-11-10', 100, 1))
    mockedDays.mockReturnValue(['2026-11-10'])

    const flights = await getCountryFlights(160)

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(flights).toHaveLength(1)
  })

  it('keys the query string on the requested country, not a fixed one', async () => {
    mockedParse.mockReturnValue(flightsOn('2026-11-10', 100, CANDIDATE_LIMIT))

    await getCountryFlights(29)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=47&country_id=29', {
      referer: 'https://flightlog.org/fl.html?l=1&a=48&country_id=29',
    })
  })

  it('propagates a fetch failure', async () => {
    mockedFetch.mockRejectedValue(new Error('boom'))

    await expect(getCountryFlights(160)).rejects.toThrow('boom')
  })
})
