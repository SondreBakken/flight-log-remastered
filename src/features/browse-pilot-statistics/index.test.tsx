import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PilotStatistics from './index'
import type { Flight } from '@/lib/flightlog/types'

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

describe('PilotStatistics', () => {
  it('renders the empty state and no summary line when the pilot has no flights', () => {
    render(<PilotStatistics flights={[]} />)

    screen.getByText(/statistics will appear once this pilot has logged flights/)
    expect(screen.queryByText(/flying days$/)).toBeNull()
  })

  // #70/#68's shape, same as browse-pilot-logbook's own regression test: two single-flight
  // rows and two aggregated rows (flightCount 1, 2, 6, 1) totalling 10 flights, not 4 rows —
  // the dashboard's totals summary must report flights, not rows.
  it('sums flightCount for the totals summary, not row count, on a mix of single and aggregated rows', () => {
    const flights: Flight[] = [
      flight({ duration: '00:05', flightCount: 1 }),
      flight({ duration: '00:10', flightCount: 2 }),
      flight({ duration: '00:30', flightCount: 6 }),
      flight({ duration: '00:06', flightCount: 1 }),
    ]

    render(<PilotStatistics flights={flights} />)

    // 5 + 10 + 30 + 6 = 51 minutes = 0.85h, formatted to one decimal.
    screen.getByText('10 flights · 0.8 h · 1 flying days')
  })

  it('counts two rows sharing one date as a single flying day, summing their flights', () => {
    const flights: Flight[] = [
      flight({ date: '2026-07-23', glider: 'Wing A', flightCount: 2 }),
      flight({ date: '2026-07-23', glider: 'Wing B', flightCount: 1 }),
      flight({ date: '2026-07-24', glider: 'Wing A', flightCount: 1 }),
    ]

    render(<PilotStatistics flights={flights} />)

    // 2 + 1 + 1 = 4 flights across three rows of 10 minutes each = 30 minutes = 0.5h.
    screen.getByText('4 flights · 0.5 h · 2 flying days')
  })

  it('renders hours-by-year, glider and site breakdowns as tables/lists, not a chart', () => {
    const flights: Flight[] = [
      flight({ date: '2024-06-01', glider: 'Mescal 6', takeoff: 'Voss, Hjelle' }),
      flight({ date: '2026-01-01', glider: 'Other Wing', takeoff: 'Voss, Hjelle' }),
    ]

    render(<PilotStatistics flights={flights} />)

    screen.getByText('2024')
    screen.getByText('2026')
    screen.getByText('Mescal 6')
    screen.getByText('Other Wing')
    screen.getByText('Voss, Hjelle')
  })

  it('labels a null glider and null takeoff as unknown rather than omitting the row', () => {
    const flights: Flight[] = [flight({ glider: null, takeoff: null })]

    render(<PilotStatistics flights={flights} />)

    screen.getByText('Unknown glider')
    screen.getByText('Unknown takeoff')
  })

  it('shows the longest flight by duration only among single-flight rows, excluding an aggregated row', () => {
    const flights: Flight[] = [
      flight({ date: '2026-05-01', duration: '05:00', flightCount: 6, takeoff: 'Aggregated Site' }),
      flight({ date: '2026-05-02', duration: '00:45', flightCount: 1, takeoff: 'Single Site' }),
    ]

    render(<PilotStatistics flights={flights} />)

    screen.getByText(/By duration: 00:45 — 2026-05-02 at Single Site/)
  })

  it('shows the longest flight by distance using the openDistanceKm fallback', () => {
    const flights: Flight[] = [
      flight({ date: '2026-05-01', distanceKm: null, openDistanceKm: 40, takeoff: 'Open Site' }),
      flight({ date: '2026-05-02', distanceKm: 15, takeoff: 'Closed Site' }),
    ]

    render(<PilotStatistics flights={flights} />)

    screen.getByText(/By distance: 40\.0 km — 2026-05-01 at Open Site/)
  })

  it('renders a heatmap cell per flying day', () => {
    const flights: Flight[] = [
      flight({ date: '2026-05-01' }),
      flight({ date: '2026-05-02' }),
      flight({ date: '2026-05-03' }),
    ]

    render(<PilotStatistics flights={flights} />)

    screen.getByText('Flying days (3)')
  })
})
