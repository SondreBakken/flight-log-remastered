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

const NO_TAKEOFFS = { shownTakeoffCount: 0, followedTakeoffCount: null, failedTakeoffs: [] }
const FEED_BASE = { shownCount: 1, followedCount: null, isLoading: false, entries: [], failedPilots: [], hasSeenBefore: true }

describe('FeedView followed takeoffs (#246)', () => {
  it('names each failed takeoff with a link to its page and says some followed takeoffs could not be loaded, still rendering a failed pilot\'s notice', () => {
    render(
      <FeedView
        {...FEED_BASE}
        {...NO_TAKEOFFS}
        shownTakeoffCount={1}
        failedPilots={[{ status: 'error', pilotId: 9, message: 'pilot down' }]}
        failedTakeoffs={[{ status: 'error', countryId: 160, takeoffId: 133, message: 'takeoff down' }]}
      />,
    )

    screen.getByText('Some followed takeoffs could not be loaded:')
    expect(screen.getByRole('link', { name: 'Takeoff 133' }).getAttribute('href')).toBe('/countries/160/takeoffs/133')
    screen.getByText(/takeoff down/)
    screen.getByText('Some followed pilots could not be loaded:')
  })

  it('renders no takeoff notice when none failed', () => {
    render(<FeedView {...FEED_BASE} {...NO_TAKEOFFS} />)

    expect(screen.queryByText(/followed takeoffs could not be loaded/)).toBeNull()
  })

  it.each([
    [{ shownCount: 1, followedCount: null, shownTakeoffCount: 0, followedTakeoffCount: null }, '1 pilot followed'],
    [{ shownCount: 0, followedCount: null, shownTakeoffCount: 2, followedTakeoffCount: null }, '2 takeoffs followed'],
    [{ shownCount: 2, followedCount: null, shownTakeoffCount: 1, followedTakeoffCount: null }, '2 pilots followed · 1 takeoff followed'],
    [
      { shownCount: 0, followedCount: null, shownTakeoffCount: 20, followedTakeoffCount: 25 },
      'following 25 takeoffs — showing recent flights from the first 20 to keep this page fast',
    ],
  ])('summarises %o as "%s"', (counts, expected) => {
    render(<FeedView {...FEED_BASE} {...NO_TAKEOFFS} {...counts} />)

    screen.getByText(expected)
  })

  it('shows no first-visit pilot caption to a takeoff-only follower', () => {
    render(<FeedView {...FEED_BASE} {...NO_TAKEOFFS} shownCount={0} shownTakeoffCount={1} hasSeenBefore={false} />)

    expect(screen.queryByText(/first time your followed pilots/)).toBeNull()
  })

  it.each([
    [1, 0, 'No recent flights from the pilots you follow.'],
    [0, 1, 'No recent flights from the takeoffs you follow.'],
    [1, 1, 'No recent flights from the pilots and takeoffs you follow.'],
  ])('words the empty state for %i pilots and %i takeoffs', (shownCount, shownTakeoffCount, expected) => {
    render(<FeedView {...FEED_BASE} {...NO_TAKEOFFS} shownCount={shownCount} shownTakeoffCount={shownTakeoffCount} />)

    screen.getByText(expected)
  })
})

describe('FlightFeedView follow states with takeoffs (#246)', () => {
  it('shows the not-following notice when the viewer follows no pilots and no takeoffs', () => {
    render(<FlightFeedView follows={{ status: 'resolved', followedPilotIds: [], followedTakeoffs: [] }} defaultPilotId={1} />)

    screen.getByText('You are not following any pilots yet.')
  })

  it('shows the feed, not the not-following notice, to a follower of one takeoff and no pilots', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(
      <FlightFeedView
        follows={{ status: 'resolved', followedPilotIds: [], followedTakeoffs: [{ countryId: 160, takeoffId: 133 }] }}
        defaultPilotId={1}
      />,
    )

    expect(screen.queryByText('You are not following any pilots yet.')).toBeNull()
    screen.getByText(/1 takeoff followed/)
    vi.unstubAllGlobals()
  })

  it('still shows the follows-unavailable notice, not the feed', () => {
    render(<FlightFeedView follows={{ status: 'follows-unavailable' }} defaultPilotId={1} />)

    screen.getByText("Couldn't load the pilots you follow right now.")
  })
})

describe('FlightFeedView', () => {
  it('shows an icon-bearing notice when the follow list is unavailable', () => {
    const { container } = render(<FlightFeedView follows={{ status: 'follows-unavailable' }} defaultPilotId={1} />)

    screen.getByText("Couldn't load the pilots you follow right now.")
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('styles the feed table with the form layer: rule borders and form-label headers', () => {
    const { container } = render(
      <FeedView shownCount={1} followedCount={null} shownTakeoffCount={0} followedTakeoffCount={null} failedTakeoffs={[]} isLoading={false} entries={[ENTRY]} failedPilots={[]} hasSeenBefore />,
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
