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

describe('PilotLogbook header', () => {
  // #70: pilot 12677's own logbook (fixtures/pilot-12677.html) is exactly this shape — two
  // single-flight rows (trip_id 1002674, 1001964) and two aggregated rows (trip_id 1002601 /
  // flightCount 2, trip_id 1002600 / flightCount 6), ten flights total, matched against
  // rqtid=1's own "Flights" column. `flights.length` (4) undercounts it by more than half.
  //
  // The two halves count deliberately different things, and the words say which. Flights can be
  // summed because every row publishes its own count. Tracked FLIGHTS cannot: one tracklog
  // exists per trip_id and an aggregated row's flights share it, with no per-flight breakdown
  // anywhere, so summing flightCount over tracked rows would over-claim. That over-claim is
  // measured — pilot 9377's trip 802531 reads flightCount 2 while its tracklog holds a single
  // descent — so this line reports tracks, which is what the index can answer.
  //
  // No assertion can verify that "10 flights shown · 2 GPS tracks" *means* what this comment
  // says. What it pins is the exact reviewed phrasing and both numbers, so a later edit that
  // reverts either half, or silently puts them back into the same unit, breaks this test
  // rather than drifting past review.
  it('counts flights for the flights half and rows for the tracks half, on a mix of single and aggregated rows', () => {
    const flights: Flight[] = [
      flight({ tripId: 1002674, duration: '00:05', flightCount: 1 }),
      flight({ tripId: 1002601, duration: '00:10', flightCount: 2 }),
      flight({ tripId: 1002600, duration: '00:30', flightCount: 6 }),
      flight({ tripId: 1001964, duration: '00:06', flightCount: 1 }),
    ]
    const trackedTripIds = new Set([1002600, 1001964])

    render(<PilotLogbook pilot={PILOT} flights={flights} trackedTripIds={trackedTripIds} />)

    screen.getByText('10 flights shown · 2 GPS tracks')
  })

  // Pins WHICH collection the track count walks. Summing or counting the track index instead of
  // the rows renders 3 here, because 999 has no row on this page — the shape of the old
  // `trackedTripIds.size` overcount, which the two tests above cannot distinguish since every
  // tracked id in them has a matching row.
  it('ignores a tracked trip that has no row on this page', () => {
    const flights: Flight[] = [
      flight({ tripId: 1002600, duration: '00:30', flightCount: 6 }),
      flight({ tripId: 1002674, duration: '00:05', flightCount: 1 }),
    ]
    const trackedTripIds = new Set([1002600, 999])

    render(<PilotLogbook pilot={PILOT} flights={flights} trackedTripIds={trackedTripIds} />)

    screen.getByText('7 flights shown · 1 GPS tracks')
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

    screen.getByText('3 flights shown · 2 GPS tracks')
  })
})
