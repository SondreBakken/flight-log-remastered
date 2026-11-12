import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FeedView, FlightFeedView } from './flight-feed-view'
import { useFlightFeedResults } from './use-flight-feed'
import type { FeedEntry } from './feed'
import type { ViewerFollowState } from '@/lib/follows/viewer-follow-state'

// Passthrough spy: the real hook still runs (the fetch-stubbed cases below need it), while the
// args tests read what FlightFeedView handed it.
vi.mock('./use-flight-feed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./use-flight-feed')>()
  return { ...actual, useFlightFeedResults: vi.fn(actual.useFlightFeedResults) }
})

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

const PILOT_ID = 900024
const TAKEOFF = { countryId: 160, takeoffId: 133 }
const BOTH_FOLLOWS: ViewerFollowState = { status: 'resolved', followedPilotIds: [PILOT_ID], followedTakeoffs: [TAKEOFF] }
const PILOTS_ONLY: ViewerFollowState = { status: 'resolved', followedPilotIds: [PILOT_ID], followedTakeoffs: [] }
const TAKEOFFS_ONLY: ViewerFollowState = { status: 'resolved', followedPilotIds: [], followedTakeoffs: [TAKEOFF] }
const FLIGHT_DATE = '2026-05-23'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

// One followed pilot's flight, also listed at the followed takeoff under the same pilot and day.
function stubFeedFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/countries/')) {
        return jsonResponse({
          takeoff: { ...TAKEOFF, name: 'Voss, Hanguren' },
          flights: [
            { tripId: 5001, userId: PILOT_ID, pilotName: 'Test Pilot', club: null, glider: null, duration: null, distanceKm: null, note: null, date: FLIGHT_DATE, timeOfDay: null },
          ],
        })
      }
      return jsonResponse({
        pilot: { userId: PILOT_ID, name: 'Test Pilot', country: null, club: null },
        flights: [
          { tripId: 991729, userId: PILOT_ID, date: FLIGHT_DATE, country: null, takeoff: 'Voss', takeoffRef: null, glider: null, duration: '1:30', flightCount: 1, distanceKm: 20, openDistanceKm: null, note: null },
        ],
        trackedTrips: [],
      })
    }),
  )
}

function lastHookArgs(): [number[], unknown[]] {
  const calls = vi.mocked(useFlightFeedResults).mock.calls
  const [pilotIds, takeoffs] = calls[calls.length - 1]
  return [pilotIds, takeoffs ?? []]
}

function toggleButton(name: string): HTMLElement {
  return screen.getByRole('button', { name })
}

function pressedLabels(): string[] {
  return screen
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent ?? '')
}

describe('FlightFeedView source toggle (#382)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    window.localStorage.clear()
    vi.mocked(useFlightFeedResults).mockClear()
    stubFeedFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders the three options with Both pressed by default, and hands the hook every pilot and takeoff', () => {
    render(<FlightFeedView follows={BOTH_FOLLOWS} defaultPilotId={1} />)

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Pilots', 'Takeoffs', 'Both'])
    expect(pressedLabels()).toEqual(['Both'])
    expect(lastHookArgs()).toEqual([[PILOT_ID], [TAKEOFF]])
  })

  it('passes no takeoffs in Pilots mode and no pilots in Takeoffs mode, then every source again in Both mode', () => {
    render(<FlightFeedView follows={BOTH_FOLLOWS} defaultPilotId={1} />)

    fireEvent.click(toggleButton('Pilots'))
    expect(lastHookArgs()).toEqual([[PILOT_ID], []])
    expect(pressedLabels()).toEqual(['Pilots'])

    fireEvent.click(toggleButton('Takeoffs'))
    expect(lastHookArgs()).toEqual([[], [TAKEOFF]])
    expect(pressedLabels()).toEqual(['Takeoffs'])

    fireEvent.click(toggleButton('Both'))
    expect(lastHookArgs()).toEqual([[PILOT_ID], [TAKEOFF]])
  })

  it('shows a followed pilot\'s flight at a followed takeoff in Takeoffs mode, and once in Both mode', async () => {
    render(<FlightFeedView follows={BOTH_FOLLOWS} defaultPilotId={1} />)
    await waitFor(() => expect(document.querySelectorAll('tbody tr')).toHaveLength(1))
    expect(screen.queryByText(/via Voss, Hanguren/)).toBeNull()

    fireEvent.click(toggleButton('Takeoffs'))

    await waitFor(() => screen.getByText(/via Voss, Hanguren/))
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/countries/160/takeoffs/133/recent-flights', expect.anything())
  })

  it.each([
    ['pilots only', PILOTS_ONLY],
    ['takeoffs only', TAKEOFFS_ONLY],
    ['nothing', { status: 'resolved', followedPilotIds: [], followedTakeoffs: [] } as ViewerFollowState],
    ['follows unavailable', { status: 'follows-unavailable' } as ViewerFollowState],
  ])('hides the toggle for a viewer following %s', (_label, follows) => {
    render(<FlightFeedView follows={follows} defaultPilotId={1} />)

    expect(screen.queryByRole('group', { name: 'Show flights from' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Both' })).toBeNull()
  })

  it('writes ?show= on Pilots and Takeoffs, drops it on Both, and keeps other params', () => {
    window.history.replaceState(null, '', '/?wind=north&show=takeoffs')
    const replaceState = vi.spyOn(window.history, 'replaceState')
    render(<FlightFeedView follows={BOTH_FOLLOWS} defaultPilotId={1} />)

    fireEvent.click(toggleButton('Pilots'))
    expect(new URL(window.location.href).search).toBe('?wind=north&show=pilots')

    fireEvent.click(toggleButton('Takeoffs'))
    expect(new URL(window.location.href).search).toBe('?wind=north&show=takeoffs')

    fireEvent.click(toggleButton('Both'))
    expect(new URL(window.location.href).search).toBe('?wind=north')
    expect(replaceState).toHaveBeenCalledTimes(3)
    replaceState.mockRestore()
  })

  it.each([
    ['?show=pilots', 'Pilots'],
    ['?show=takeoffs', 'Takeoffs'],
    ['?show=bogus', 'Both'],
    ['?show=', 'Both'],
    ['', 'Both'],
  ])('mounting at "%s" selects %s', (search, expected) => {
    window.history.replaceState(null, '', `/${search}`)
    render(<FlightFeedView follows={BOTH_FOLLOWS} defaultPilotId={1} />)

    expect(pressedLabels()).toEqual([expected])
  })

  it('server-renders Both whatever ?show= says, so hydration matches the server', () => {
    window.history.replaceState(null, '', '/?show=pilots')
    const html = renderToString(<FlightFeedView follows={BOTH_FOLLOWS} defaultPilotId={1} />)

    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Both</)
    expect(html).not.toMatch(/<button[^>]*aria-pressed="true"[^>]*>Pilots</)
  })

  it.each([
    ['pilots only', PILOTS_ONLY, [[PILOT_ID], []]],
    ['takeoffs only', TAKEOFFS_ONLY, [[], [TAKEOFF]]],
  ])('ignores a saved ?show=takeoffs and ?show=pilots mode the viewer cannot toggle (%s)', (_label, follows, expected) => {
    for (const saved of ['pilots', 'takeoffs']) {
      window.history.replaceState(null, '', `/?show=${saved}`)
      vi.mocked(useFlightFeedResults).mockClear()
      const { unmount } = render(<FlightFeedView follows={follows} defaultPilotId={1} />)
      expect(lastHookArgs()).toEqual(expected)
      unmount()
    }
  })
})
