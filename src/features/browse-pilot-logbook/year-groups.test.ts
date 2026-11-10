import { describe, expect, it } from 'vitest'
import type { Flight } from '@/lib/flightlog/types'
import { groupFlightsByYear } from './year-groups'

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

describe('groupFlightsByYear', () => {
  const flights = [
    flight({ date: '2026-07-01', duration: '1:00', distanceKm: 10 }),
    flight({ date: '2022-05-01', duration: '0:30', flightCount: 2, distanceKm: 5 }),
    flight({ date: '2022-00-00', duration: '0:15', openDistanceKm: 2 }),
    flight({ date: '2024-03-03', duration: '2:00', distanceKm: 20 }),
  ]

  it('orders years newest first, with placeholder dates grouped under their year', () => {
    const groups = groupFlightsByYear(flights)
    expect(groups.map((g) => g.year)).toEqual([2026, 2024, 2022])
    expect(groups[2].flights).toHaveLength(2)
  })

  it('computes this-year, brought-forward and cumulative totals across a year gap and an aggregated row', () => {
    const [y2026, y2024, y2022] = groupFlightsByYear(flights)

    expect(y2022.thisYear).toEqual({ flightCount: 3, minutes: 45, distanceKm: 7 })
    expect(y2022.broughtForward).toEqual({ flightCount: 0, minutes: 0, distanceKm: 0 })
    expect(y2022.cumulative).toEqual({ flightCount: 3, minutes: 45, distanceKm: 7 })

    expect(y2024.thisYear).toEqual({ flightCount: 1, minutes: 120, distanceKm: 20 })
    expect(y2024.broughtForward).toEqual(y2022.cumulative)
    expect(y2024.cumulative).toEqual({ flightCount: 4, minutes: 165, distanceKm: 27 })

    expect(y2026.thisYear).toEqual({ flightCount: 1, minutes: 60, distanceKm: 10 })
    expect(y2026.broughtForward).toEqual(y2024.cumulative)
    expect(y2026.cumulative).toEqual({ flightCount: 5, minutes: 225, distanceKm: 37 })
  })

  it('returns no groups for no flights', () => {
    expect(groupFlightsByYear([])).toEqual([])
  })
})
