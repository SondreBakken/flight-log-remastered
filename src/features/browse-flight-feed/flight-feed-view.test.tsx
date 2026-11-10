import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeedView, FlightFeedView } from './flight-feed-view'
import type { FeedEntry } from './feed'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const ENTRY: FeedEntry = {
  pilot: { userId: 900001, name: 'Pilot One', country: null, club: null },
  flight: {
    tripId: 9000001,
    userId: 900001,
    date: '2026-05-01',
    country: null,
    takeoff: 'Site',
    takeoffRef: null,
    glider: null,
    duration: '2:15',
    flightCount: 1,
    distanceKm: 38.4,
    openDistanceKm: null,
    note: null,
  },
  hasTrack: true,
  newness: 'not-new',
  trackedAt: '20260501000000',
}

describe('FlightFeedView', () => {
  it('shows an icon-bearing notice when the follow list is unavailable', () => {
    const { container } = render(<FlightFeedView follows={{ status: 'follows-unavailable' }} defaultPilotId={1} />)

    screen.getByText("Couldn't load the pilots you follow right now.")
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('styles the feed table with the form layer: rule borders and form-label headers', () => {
    const { container } = render(
      <FeedView shownCount={1} followedCount={null} isLoading={false} entries={[ENTRY]} failedPilots={[]} hasSeenBefore />,
    )

    expect(container.querySelector('thead tr')?.className).toContain('border-rule')
    const headers = [...container.querySelectorAll('thead th')]
    expect(headers.length).toBeGreaterThan(0)
    for (const th of headers) expect(th.className).toContain('form-label')
    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(1)
    for (const tr of rows) expect(tr.className).toContain('border-rule')
  })
})
