import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./country-flights', () => ({ getCountryFlights: vi.fn(), CANDIDATE_LIMIT: 5 }))
vi.mock('./tracks', () => ({ hasTrack: vi.fn() }))

import { getCountryFlights } from './country-flights'
import { hasTrack } from './tracks'
import { getRecentTrackedFlights } from './recent-public-flights'
import type { TakeoffFlight } from './types'

const mockedList = vi.mocked(getCountryFlights)
const mockedHasTrack = vi.mocked(hasTrack)

function flights(count: number): TakeoffFlight[] {
  return Array.from({ length: count }, (_, i) => ({
    tripId: 100 + i,
    userId: 1,
    pilotName: 'Pilot',
    club: null,
    glider: null,
    duration: null,
    distanceKm: null,
    note: null,
    date: '2026-11-10',
    timeOfDay: null,
  }))
}

describe('getRecentTrackedFlights', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('checks only the first 5 rows and returns those with a track, in list order', async () => {
    mockedList.mockResolvedValue(flights(8))
    const withTrack = new Set([101, 103, 105, 107])
    mockedHasTrack.mockImplementation(async (tripId) => withTrack.has(tripId))

    const result = await getRecentTrackedFlights(160)

    expect(mockedList).toHaveBeenCalledWith(160)
    expect(mockedHasTrack.mock.calls.map(([tripId]) => tripId).sort()).toEqual([100, 101, 102, 103, 104])
    expect(result.map((flight) => flight.tripId)).toEqual([101, 103])
  })

  it('restores list order even when the checks settle in reverse', async () => {
    mockedList.mockResolvedValue(flights(3))
    mockedHasTrack.mockImplementation(
      (tripId) => new Promise((resolve) => setTimeout(() => resolve(true), (103 - tripId) * 5)),
    )

    const result = await getRecentTrackedFlights(160)

    expect(result.map((flight) => flight.tripId)).toEqual([100, 101, 102])
  })

  it('checks only the rows that exist when the list is shorter than 5', async () => {
    mockedList.mockResolvedValue(flights(2))
    mockedHasTrack.mockResolvedValue(true)

    const result = await getRecentTrackedFlights(160)

    expect(mockedHasTrack).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(2)
  })

  it('never has more than 4 checks in flight at once', async () => {
    mockedList.mockResolvedValue(flights(5))
    let inFlight = 0
    let peak = 0
    mockedHasTrack.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return true
    })

    await getRecentTrackedFlights(160)

    expect(mockedHasTrack).toHaveBeenCalledTimes(5)
    expect(peak).toBe(4)
  })

  it('drops only the row whose hasTrack rejects', async () => {
    mockedList.mockResolvedValue(flights(3))
    mockedHasTrack.mockImplementation(async (tripId) => {
      if (tripId === 101) throw new Error('rqtid failed')
      return true
    })

    const result = await getRecentTrackedFlights(160)

    expect(result.map((flight) => flight.tripId)).toEqual([100, 102])
  })

  it('propagates a failure of the list fetch', async () => {
    mockedList.mockRejectedValue(new Error('list down'))

    await expect(getRecentTrackedFlights(160)).rejects.toThrow('list down')
    expect(mockedHasTrack).not.toHaveBeenCalled()
  })

  it('defaults to Norway', async () => {
    mockedList.mockResolvedValue([])

    await getRecentTrackedFlights()

    expect(mockedList).toHaveBeenCalledWith(160)
  })
})
