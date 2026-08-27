import { describe, expect, it } from 'vitest'
import type { Flight } from '@/lib/flightlog/types'
import {
  distinctSiteCount,
  flyingDayCount,
  singleFlightsOverMinutes,
  totalHours,
  xcLikeFlightCount,
} from './experience'

let nextTripId = 1
function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    tripId: nextTripId++,
    userId: 12677,
    date: '2026-07-23',
    country: 'Norway',
    takeoff: 'Voss, Hjelle/Gjelle',
    takeoffRef: null,
    glider: 'skywalk Mescal 6',
    duration: '00:10',
    flightCount: 1,
    distanceKm: null,
    openDistanceKm: null,
    note: null,
    ...overrides,
  }
}

describe('distinctSiteCount', () => {
  it('counts distinct takeoff names', () => {
    const flights = [flight({ takeoff: 'Voss' }), flight({ takeoff: 'Voss' }), flight({ takeoff: 'Sunnfjord' })]
    expect(distinctSiteCount(flights)).toBe(2)
  })
})

describe('singleFlightsOverMinutes', () => {
  it('counts single-flight rows strictly over the threshold', () => {
    const flights = [
      flight({ duration: '00:25', flightCount: 1 }),
      flight({ duration: '00:15', flightCount: 1 }),
    ]
    expect(singleFlightsOverMinutes(flights, 20)).toBe(1)
  })

  it('excludes aggregated rows (flightCount > 1) even when the group total clears the threshold', () => {
    const flights = [flight({ duration: '00:40', flightCount: 3 })]
    expect(singleFlightsOverMinutes(flights, 20)).toBe(0)
  })

  it('excludes rows with no recorded duration', () => {
    const flights = [flight({ duration: null, flightCount: 1 })]
    expect(singleFlightsOverMinutes(flights, 20)).toBe(0)
  })
})

describe('xcLikeFlightCount', () => {
  it('counts rows whose distance is over the 10km threshold', () => {
    const flights = [flight({ distanceKm: 15 }), flight({ distanceKm: 5 }), flight({ distanceKm: null, openDistanceKm: 12 })]
    expect(xcLikeFlightCount(flights)).toBe(2)
  })

  it('excludes a row exactly at the threshold', () => {
    const flights = [flight({ distanceKm: 10 })]
    expect(xcLikeFlightCount(flights)).toBe(0)
  })
})

describe('totalHours', () => {
  it('converts total minutes to hours', () => {
    const flights = [flight({ duration: '01:30', flightCount: 1 })]
    expect(totalHours(flights)).toBe(1.5)
  })
})

describe('flyingDayCount', () => {
  it('counts distinct calendar days with a flight', () => {
    const flights = [flight({ date: '2026-01-01' }), flight({ date: '2026-01-01' }), flight({ date: '2026-01-02' })]
    expect(flyingDayCount(flights)).toBe(2)
  })
})
