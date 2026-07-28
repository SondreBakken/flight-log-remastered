import { describe, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PilotLogbook from './index'
import type { Flight, Pilot } from '@/lib/flightlog/types'

const PILOT: Pilot = {
  userId: 12677,
  name: 'Test Pilot',
  country: 'Norway',
  club: 'Voss HPK',
}

function flight(overrides: Partial<Flight>): Flight {
  return {
    tripId: 1,
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

describe('PilotLogbook header', () => {
  // #70: pilot 12677's own logbook (fixtures/pilot-12677.html) is exactly this shape — two
  // single-flight rows (trip_id 1002674, 1001964) and two aggregated rows (trip_id 1002601 /
  // flightCount 2, trip_id 1002600 / flightCount 6), ten flights total, matched against
  // rqtid=1's own "Flights" column. `flights.length` (4) undercounts it by more than half.
  //
  // The tracked half of the line has the identical row-vs-flight ambiguity: a GPS track is
  // recorded per trip_id (one continuous tracklog covering that trip's whole session), so a
  // tracked aggregated row's entire flightCount is honestly "covered by a track" — there is no
  // per-flight breakdown to divide it by. Here trip_id 1002600 (flightCount 6) and trip_id
  // 1001964 (flightCount 1) are tracked, trip_id 1002601 (flightCount 2) is not: 7 flights
  // tracked, not the 2 tracked ROWS the old `trackedTripIds.size` would have reported.
  //
  // No assertion can verify that "10 flights shown · 7 with a GPS track" *means* what this
  // comment says it means — meaning is a property of the reader. What this pins is the exact
  // reviewed phrasing and numbers, so a later edit that quietly reverts either half to a row
  // count, or leaves the two halves counting different units, breaks this test rather than
  // drifting past review unnoticed.
  it('counts flights, not table rows, on both halves of the header line — mixing single-flight and aggregated rows', () => {
    const flights: Flight[] = [
      flight({ tripId: 1002674, duration: '00:05', flightCount: 1 }),
      flight({ tripId: 1002601, duration: '00:10', flightCount: 2 }),
      flight({ tripId: 1002600, duration: '00:30', flightCount: 6 }),
      flight({ tripId: 1001964, duration: '00:06', flightCount: 1 }),
    ]
    const trackedTripIds = new Set([1002600, 1001964])

    render(<PilotLogbook pilot={PILOT} flights={flights} trackedTripIds={trackedTripIds} />)

    screen.getByText('10 flights shown · 7 with a GPS track')
  })

  // The extreme opposite of the boundary case above: fixtures/pilot-4549.html's 134 rows are
  // all single-flight (no aggregation at all), so row count and flight count coincide here —
  // this pins that the fix doesn't change behaviour for the common, non-aggregated case.
  it('renders row count and flight count as the same number when no row is aggregated', () => {
    const flights: Flight[] = [
      flight({ tripId: 1, flightCount: 1 }),
      flight({ tripId: 2, flightCount: 1 }),
      flight({ tripId: 3, flightCount: 1 }),
    ]
    const trackedTripIds = new Set([1, 3])

    render(<PilotLogbook pilot={PILOT} flights={flights} trackedTripIds={trackedTripIds} />)

    screen.getByText('3 flights shown · 2 with a GPS track')
  })
})
