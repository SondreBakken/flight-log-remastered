import { describe, expect, it } from 'vitest'
import type { Flight } from './types'
import { totalFlightCount } from './flight-count'

let nextTripId = 1
function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    tripId: nextTripId++,
    userId: 12677,
    date: '2026-07-23',
    country: 'Norway',
    takeoff: 'Voss, Hjelle/Gjelle',
    glider: 'skywalk Mescal 6',
    duration: '00:10',
    flightCount: 1,
    distanceKm: null,
    openDistanceKm: null,
    note: null,
    ...overrides,
  }
}

describe('totalFlightCount', () => {
  it('returns 0 for no rows', () => {
    expect(totalFlightCount([])).toBe(0)
  })

  it('sums flightCount across rows rather than counting rows', () => {
    // #70's measured shape: pilot 12677's four rows (flightCount 1, 2, 6, 1) are ten flights.
    const flights = [
      flight({ flightCount: 1 }),
      flight({ flightCount: 2 }),
      flight({ flightCount: 6 }),
      flight({ flightCount: 1 }),
    ]

    expect(totalFlightCount(flights)).toBe(10)
  })

  it('coincides with row count when no row is aggregated', () => {
    const flights = [flight({ flightCount: 1 }), flight({ flightCount: 1 }), flight({ flightCount: 1 })]

    expect(totalFlightCount(flights)).toBe(3)
  })
})
