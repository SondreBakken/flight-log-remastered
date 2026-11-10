import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import PilotLogbook from './index'
import type { Flight, Pilot } from '@/lib/flightlog/types'

// FlightRow (rendered per row below) is a client component that calls useRouter for its
// whole-row click navigation (#213) — outside a real app router tree that throws, so it's
// stubbed the same way sign-in/index.test.tsx stubs next/navigation for its own hook use.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

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

    render(
      <PilotLogbook
        pilot={PILOT}
        flights={flights}
        trackedTripIds={trackedTripIds}
        isFollowed={false}
        isSignedIn={false}
        isVerified={false}
        mapSlot={null}
      />,
    )

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

    render(
      <PilotLogbook
        pilot={PILOT}
        flights={flights}
        trackedTripIds={trackedTripIds}
        isFollowed={false}
        isSignedIn={false}
        isVerified={false}
        mapSlot={null}
      />,
    )

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

    render(
      <PilotLogbook
        pilot={PILOT}
        flights={flights}
        trackedTripIds={trackedTripIds}
        isFollowed={false}
        isSignedIn={false}
        isVerified={false}
        mapSlot={null}
      />,
    )

    screen.getByText('3 flights shown · 2 GPS tracks')
  })
})

describe('PilotLogbook verified-account icon', () => {
  const VERIFIED_LABEL = 'Has an account on Flight Log Remastered'

  function renderLogbook(isVerified: boolean) {
    render(
      <PilotLogbook
        pilot={PILOT}
        flights={[]}
        trackedTripIds={new Set()}
        isFollowed={false}
        isSignedIn={false}
        isVerified={isVerified}
        mapSlot={null}
      />,
    )
  }

  it('shows the icon with a tooltip next to the pilot name when the pilot has a verified account', () => {
    renderLogbook(true)

    const icon = screen.getByRole('img', { name: VERIFIED_LABEL })
    expect(icon.getAttribute('title')).toBe(VERIFIED_LABEL)
    expect(screen.getByRole('heading', { level: 1 }).parentElement?.contains(icon)).toBe(true)
  })

  it('shows no icon when the pilot has no verified account', () => {
    renderLogbook(false)

    expect(screen.queryByRole('img', { name: VERIFIED_LABEL })).toBeNull()
  })
})

describe('PilotLogbook year groups', () => {
  const FLIGHTS: Flight[] = [
    flight({ tripId: 1, date: '2026-07-01', duration: '1:00', distanceKm: 10 }),
    flight({ tripId: 2, date: '2024-03-03', duration: '2:00', distanceKm: 20 }),
    flight({ tripId: 3, date: '2024-00-00', duration: '0:30', flightCount: 2 }),
  ]

  function renderLogbook(flights: Flight[], mapSlot: ReactNode = null) {
    return render(
      <PilotLogbook
        pilot={PILOT}
        flights={flights}
        trackedTripIds={new Set([1])}
        isFollowed={false}
        isSignedIn={false}
        isVerified={false}
        mapSlot={mapSlot}
      />,
    )
  }

  it('stacks the table below sm: with a visually hidden header and labelled totals cells', () => {
    const { container } = renderLogbook(FLIGHTS)
    const details = container.querySelector('details') as HTMLDetailsElement

    expect(details.querySelector('thead')?.className).toContain('max-sm:sr-only')
    for (const tag of ['table', 'tbody', 'tfoot']) expect(details.querySelector(tag)?.className).toContain('max-sm:block')
    const totals = [...details.querySelectorAll('tfoot tr')]
    for (const tr of totals) {
      expect(tr.className).toContain('max-sm:block')
      expect([...tr.querySelectorAll('td')].map((td) => td.getAttribute('data-label'))).toEqual(['Flights', 'Time', 'Distance'])
    }
    expect(totals).toHaveLength(3)
  })

  it('renders one details per year, newest first, with only the newest open', () => {
    const { container } = renderLogbook(FLIGHTS)

    const sections = [...container.querySelectorAll('details')]
    expect(sections.map((d) => d.querySelector('summary')?.textContent)).toEqual([
      '2026 · 1 flight',
      '2024 · 3 flights',
    ])
    expect(sections.map((d) => d.open)).toEqual([true, false])
    expect(sections[1].querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('ends each year with this year, brought forward and cumulative footers', () => {
    const { container } = renderLogbook(FLIGHTS)

    const footerRows = (details: Element) =>
      [...details.querySelectorAll('tfoot tr')].map((tr) => tr.textContent)
    const [y2026, y2024] = [...container.querySelectorAll('details')]

    expect(footerRows(y2026)).toEqual([
      'This year1 flight1.0 h10.0 km',
      'Brought forward3 flights2.5 h20.0 km',
      'Cumulative total4 flights3.5 h30.0 km',
    ])
    expect(footerRows(y2024)).toEqual([
      'This year3 flights2.5 h20.0 km',
      'Brought forward0 flights0.0 h0.0 km',
      'Cumulative total3 flights2.5 h20.0 km',
    ])
  })

  it('renders the summary, then the map slot, then the first year table', () => {
    const { container } = renderLogbook(FLIGHTS, <div data-testid="map-slot" />)

    const order = [
      screen.getByRole('region', { name: 'Summary' }),
      screen.getByTestId('map-slot'),
      container.querySelector('details') as Element,
    ]
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders the empty state without a summary or the map slot when there are no flights', () => {
    const { container } = renderLogbook([], <div data-testid="map-slot" />)

    screen.getByText(/No flights found/)
    expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull()
    expect(screen.queryByTestId('map-slot')).toBeNull()
    expect(container.querySelector('details')).toBeNull()
  })
})
