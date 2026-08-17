import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SCORING_KINDS } from '@/lib/flightlog/types'
import type { ScoringGeometryKind, ScoringGeometryResult, Track } from '@/lib/flightlog/types'

// Mocking the whole module (hoisted above these imports by Vitest) means the real 'server-only'
// fetchers never run, same reasoning as the sibling takeoffs/[takeoffId]/page.test.tsx.
vi.mock('@/lib/flightlog/tracks', () => ({ getTrack: vi.fn(), hasTrack: vi.fn() }))
vi.mock('@/lib/flightlog/flight-detail', () => ({ getFlightDetail: vi.fn() }))
vi.mock('@/lib/flightlog/config', () => ({ flightlogFlightUrl: vi.fn(() => 'https://flightlog.org/stub') }))
// FlightTrack renders a real maplibre map against a canvas jsdom can't provide (see that
// component's own test suite for why it's stubbed there too) — this suite only cares about
// whether Flight decides to render it at all, not its internals.
vi.mock('@/features/show-flight-track', () => ({
  default: ({ track }: { track: Track }) => <div data-testid="flight-track">track {track.tripId}</div>,
}))
// CommentsOnFlight is an async server component that talks to Supabase — irrelevant to what
// Flight decides to render around it, so it's replaced with a synchronous marker.
vi.mock('@/features/comment-on-flight', () => ({
  default: ({ tripId }: { tripId: number }) => <div data-testid="comments-on-flight">comments {tripId}</div>,
}))

import { getTrack, hasTrack } from '@/lib/flightlog/tracks'
import { getFlightDetail } from '@/lib/flightlog/flight-detail'
import { Flight } from './page'

const mockedGetTrack = vi.mocked(getTrack)
const mockedHasTrack = vi.mocked(hasTrack)
const mockedGetFlightDetail = vi.mocked(getFlightDetail)

const STUB_DETAIL = {
  tripId: 123,
  date: '2026-07-21',
  country: 'Norway',
  takeoff: 'Voss, Hjelle/Gjelle',
  takeoffRef: { countryId: 160, takeoffId: 133 },
  glider: 'Skywalk Mescal 6',
  duration: '00:06',
  distanceKm: null,
  maxAltitude: null,
  description: 'Min første høydetur',
  takeoffType: 'mountain',
}

const EMPTY_SCORING = Object.fromEntries(SCORING_KINDS.map((kind) => [kind, null])) as Record<
  ScoringGeometryKind,
  ScoringGeometryResult
>

function stubTrack(tripId: number): Track {
  return { tripId, points: [], stats: 'unparseable', scoring: EMPTY_SCORING }
}

describe('Flight', () => {
  // #213/#215: most flights on a pilot's logbook have no GPS track, and parseTrack (via
  // getTrack) deliberately throws when a trip has no track placemark at all. Checking hasTrack
  // first is what keeps that throw meaningful — this pins that getTrack is never even called
  // for an untracked trip, not just that the page happens not to crash. #215 replaced the old
  // bare "no track" notice with flightlog.org's own a=34 detail table (see the tests below), so
  // this now pins the fetch/skip contract only.
  it('skips getTrack and calls getFlightDetail when hasTrack is false', async () => {
    mockedHasTrack.mockResolvedValue(false)
    mockedGetFlightDetail.mockResolvedValue(STUB_DETAIL)

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    expect(mockedHasTrack).toHaveBeenCalledWith(123)
    expect(mockedGetTrack).not.toHaveBeenCalled()
    expect(mockedGetFlightDetail).toHaveBeenCalledWith(123)
    expect(screen.queryByTestId('flight-track')).toBeNull()
  })

  it('fetches and renders the track when hasTrack is true, without ever calling getFlightDetail', async () => {
    mockedHasTrack.mockResolvedValue(true)
    mockedGetTrack.mockResolvedValue(stubTrack(123))

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    expect(mockedGetTrack).toHaveBeenCalledWith(123)
    expect(mockedGetFlightDetail).not.toHaveBeenCalled()
    screen.getByTestId('flight-track')
  })

  // #215's own feature: flightlog.org's own a=34 detail table rendered in place of the old bare
  // notice, for an untracked trip that DOES have a real flight-detail record.
  it('renders the flight detail table when hasTrack is false and getFlightDetail succeeds', async () => {
    mockedHasTrack.mockResolvedValue(false)
    mockedGetFlightDetail.mockResolvedValue(STUB_DETAIL)

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    screen.getByText('Voss, Hjelle/Gjelle')
    screen.getByText('Skywalk Mescal 6')
    screen.getByText('mountain')
    screen.getByText('Min første høydetur')
    expect(screen.queryByTestId('flight-track')).toBeNull()
  })

  // The Takeoff cell links into this app's own takeoff detail page via the parsed takeoffRef,
  // not a raw flightlog.org URL — same internal-navigation convention
  // browse-takeoff-detail/index.tsx's own SiteRecords already uses for a trip_id link.
  it("links the detail table's Takeoff value to this app's own takeoff detail page", async () => {
    mockedHasTrack.mockResolvedValue(false)
    mockedGetFlightDetail.mockResolvedValue(STUB_DETAIL)

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    expect(screen.getByRole('link', { name: 'Voss, Hjelle/Gjelle' }).getAttribute('href')).toBe('/countries/160/takeoffs/133')
  })

  // A trip with neither a GPS track nor an a=34 record does not exist — see parseFlightDetail's
  // own doc comment on why getFlightDetail returning null is flightlog.org's own positive "no
  // such trip_id" signal, not a scrape failure to swallow into some fallback UI.
  it('renders notFound when hasTrack is false and getFlightDetail returns null', async () => {
    mockedHasTrack.mockResolvedValue(false)
    mockedGetFlightDetail.mockResolvedValue(null)

    await expect(Flight({ params: Promise.resolve({ tripId: '123' }) })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    })
  })

  it.each([true, false])('renders CommentsOnFlight regardless of hasTrack (hasTrack=%s)', async (tracked) => {
    mockedHasTrack.mockResolvedValue(tracked)
    if (tracked) {
      mockedGetTrack.mockResolvedValue(stubTrack(123))
    } else {
      mockedGetFlightDetail.mockResolvedValue(STUB_DETAIL)
    }

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    screen.getByTestId('comments-on-flight')
  })
})
