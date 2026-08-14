import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SCORING_KINDS } from '@/lib/flightlog/types'
import type { ScoringGeometryKind, ScoringGeometryResult, Track } from '@/lib/flightlog/types'

// Mocking the whole module (hoisted above these imports by Vitest) means the real 'server-only'
// fetchers never run, same reasoning as the sibling takeoffs/[takeoffId]/page.test.tsx.
vi.mock('@/lib/flightlog/tracks', () => ({ getTrack: vi.fn(), hasTrack: vi.fn() }))
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
import { Flight } from './page'

const mockedGetTrack = vi.mocked(getTrack)
const mockedHasTrack = vi.mocked(hasTrack)

const EMPTY_SCORING = Object.fromEntries(SCORING_KINDS.map((kind) => [kind, null])) as Record<
  ScoringGeometryKind,
  ScoringGeometryResult
>

function stubTrack(tripId: number): Track {
  return { tripId, points: [], stats: 'unparseable', scoring: EMPTY_SCORING }
}

describe('Flight', () => {
  // #213: most flights on a pilot's logbook have no GPS track, and parseTrack (via getTrack)
  // deliberately throws when a trip has no track placemark at all. Checking hasTrack first is
  // what keeps that throw meaningful — this pins that getTrack is never even called for an
  // untracked trip, not just that the page happens not to crash.
  it('skips getTrack and renders a no-track notice when hasTrack is false', async () => {
    mockedHasTrack.mockResolvedValue(false)

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    expect(mockedHasTrack).toHaveBeenCalledWith(123)
    expect(mockedGetTrack).not.toHaveBeenCalled()
    screen.getByText('No GPS track for this flight.')
    expect(screen.queryByTestId('flight-track')).toBeNull()
  })

  it('fetches and renders the track when hasTrack is true', async () => {
    mockedHasTrack.mockResolvedValue(true)
    mockedGetTrack.mockResolvedValue(stubTrack(123))

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    expect(mockedGetTrack).toHaveBeenCalledWith(123)
    screen.getByTestId('flight-track')
    expect(screen.queryByText('No GPS track for this flight.')).toBeNull()
  })

  it.each([true, false])('renders CommentsOnFlight regardless of hasTrack (hasTrack=%s)', async (tracked) => {
    mockedHasTrack.mockResolvedValue(tracked)
    if (tracked) mockedGetTrack.mockResolvedValue(stubTrack(123))

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    screen.getByTestId('comments-on-flight')
  })
})
