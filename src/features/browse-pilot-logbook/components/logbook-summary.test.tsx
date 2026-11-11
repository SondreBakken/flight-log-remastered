import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { Flight } from '@/lib/flightlog/types'
import { LogbookSummary } from './logbook-summary'

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

function listItems(title: string): string[] {
  const heading = screen.getByRole('heading', { name: title })
  return within(heading.parentElement as HTMLElement)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

describe('LogbookSummary', () => {
  it('shows flights, hours and distance totals', () => {
    render(
      <LogbookSummary
        flights={[
          flight({ duration: '0:51', distanceKm: 10 }),
          flight({ duration: '1:00', flightCount: 2, openDistanceKm: 2.5 }),
        ]}
      />,
    )

    expect(screen.getByText('Flights').nextSibling?.textContent).toBe('3')
    expect(screen.getByText('Hours').nextSibling?.textContent).toBe('1.9 h')
    expect(screen.getByText('Distance').nextSibling?.textContent).toBe('12.5 km')
  })

  it('lists the 5 largest takeoffs by flight count, ties in insertion order', () => {
    const sites = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    const flights = [
      ...sites.map((takeoff) => flight({ takeoff })),
      flight({ takeoff: 'G', flightCount: 3 }),
      flight({ takeoff: 'F', flightCount: 1 }),
    ]
    render(<LogbookSummary flights={flights} />)

    expect(listItems('Top takeoffs')).toEqual(['G4', 'F2', 'A1', 'B1', 'C1'])
  })

  it('lists the 5 largest gliders by flight count', () => {
    const gliders = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']
    render(<LogbookSummary flights={gliders.map((glider, i) => flight({ glider, flightCount: i + 1 }))} />)

    expect(listItems('Top gliders')).toEqual(['g66', 'g55', 'g44', 'g33', 'g22'])
  })
})
