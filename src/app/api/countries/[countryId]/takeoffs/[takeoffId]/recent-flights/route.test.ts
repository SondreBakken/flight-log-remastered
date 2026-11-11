import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/flightlog/takeoff-detail', () => ({ getTakeoffDetail: vi.fn() }))
vi.mock('@/lib/flightlog/takeoff-flights', () => ({ getTakeoffFlights: vi.fn() }))
vi.mock('@/lib/flightlog/curated-countries', () => ({
  parseCuratedCountryId: (raw: string) => (raw === '160' ? 160 : null),
}))

import { getTakeoffDetail } from '@/lib/flightlog/takeoff-detail'
import { getTakeoffFlights } from '@/lib/flightlog/takeoff-flights'
import type { TakeoffDetail, TakeoffFlight } from '@/lib/flightlog/types'
import { GET } from './route'
import { parseTakeoffRecentFlightsBody } from './contract'

const mockedGetTakeoffDetail = vi.mocked(getTakeoffDetail)
const mockedGetTakeoffFlights = vi.mocked(getTakeoffFlights)

const DETAIL: TakeoffDetail = {
  takeoffId: 133,
  name: 'Voss, Hanguren',
  region: null,
  altitude: null,
  description: null,
  linkUrl: null,
  createdAt: null,
  updatedAt: null,
  siteRecords: [],
}

function flight(tripId: number, date: string | null): TakeoffFlight {
  return {
    tripId,
    userId: 900024,
    pilotName: 'Test Pilot',
    club: null,
    glider: null,
    duration: null,
    distanceKm: null,
    note: null,
    date,
    timeOfDay: null,
  }
}

function call(countryId: string, takeoffId: string) {
  return GET(new Request('http://localhost/x'), { params: Promise.resolve({ countryId, takeoffId }) })
}

beforeEach(() => {
  mockedGetTakeoffDetail.mockReset()
  mockedGetTakeoffFlights.mockReset()
})

describe('GET recent-flights for a takeoff', () => {
  it.each([
    ['160', 'abc'],
    ['160', '1.5'],
    ['160', '0'],
    ['160', '-3'],
    ['160', '1e2'],
    ['160', '010'],
    ['29', '133'],
    ['abc', '133'],
  ])('responds 400 for %s/%s without reaching upstream', async (countryId, takeoffId) => {
    const response = await call(countryId, takeoffId)

    expect(response.status).toBe(400)
    expect(mockedGetTakeoffFlights).not.toHaveBeenCalled()
    expect(mockedGetTakeoffDetail).not.toHaveBeenCalled()
  })

  it('caps the ids echoed in the 400 body', async () => {
    const response = await call('9'.repeat(4000), '8'.repeat(4000))
    const body = (await response.json()) as { error: string }

    expect(body.error.length).toBeLessThan(120)
  })

  it('responds 404 when the flights loader reports no such takeoff', async () => {
    mockedGetTakeoffDetail.mockResolvedValue(DETAIL)
    mockedGetTakeoffFlights.mockResolvedValue(null)

    expect((await call('160', '133')).status).toBe(404)
  })

  it('responds 404 when the detail loader reports no such takeoff', async () => {
    mockedGetTakeoffDetail.mockResolvedValue(null)
    mockedGetTakeoffFlights.mockResolvedValue([])

    expect((await call('160', '133')).status).toBe(404)
  })

  it('responds 502 with a generic body, never the upstream message, when a loader throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedGetTakeoffDetail.mockResolvedValue(DETAIL)
    mockedGetTakeoffFlights.mockRejectedValue(new Error('flightlog.org returned 500 for /fl.html?a=42'))

    const response = await call('160', '133')

    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('flightlog.org')
  })

  it('responds with the takeoff name and the 30 newest dated flights, newest first', async () => {
    mockedGetTakeoffDetail.mockResolvedValue(DETAIL)
    const flights = Array.from({ length: 31 }, (_, index) => flight(index + 1, `2026-01-${String((index % 28) + 1).padStart(2, '0')}`))
    flights.push(flight(500, null))
    mockedGetTakeoffFlights.mockResolvedValue(flights)

    const response = await call('160', '133')
    const body = parseTakeoffRecentFlightsBody(await response.json())

    expect(response.status).toBe(200)
    expect(body?.takeoff).toEqual({ countryId: 160, takeoffId: 133, name: 'Voss, Hanguren' })
    expect(body?.flights).toHaveLength(30)
    expect(body?.flights.every((entry) => entry.date !== null)).toBe(true)
    const dates = body?.flights.map((entry) => entry.date) ?? []
    expect(dates).toEqual([...dates].sort().reverse())
    expect(mockedGetTakeoffFlights).toHaveBeenCalledWith(160, 133)
  })
})

describe('parseTakeoffRecentFlightsBody', () => {
  const takeoff = { countryId: 160, takeoffId: 133, name: 'Voss' }

  it.each([
    ['null', null],
    ['no takeoff', { flights: [] }],
    ['takeoff without name', { takeoff: { countryId: 160, takeoffId: 133 }, flights: [] }],
    ['flights not an array', { takeoff, flights: 'x' }],
    ['a flight without pilotName', { takeoff, flights: [{ tripId: 1, userId: 2, club: null, date: null }] }],
  ])('rejects a malformed body: %s', (_label, body) => {
    expect(parseTakeoffRecentFlightsBody(body)).toBeNull()
  })

  it('accepts a well-formed body', () => {
    const body = { takeoff, flights: [flight(1, '2026-05-01')] }
    expect(parseTakeoffRecentFlightsBody(body)).toEqual(body)
  })
})
