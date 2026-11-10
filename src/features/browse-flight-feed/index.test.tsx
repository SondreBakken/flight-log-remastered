import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/follows/resolve-viewer-follow-state', () => ({ resolveViewerFollowState: vi.fn() }))
vi.mock('./signed-out-home', () => ({ SignedOutHome: vi.fn(() => null) }))

import FlightFeed, { FlightFeedView } from './index'
import { SignedOutHome } from './signed-out-home'
import { resolveViewerFollowState } from '@/lib/follows/resolve-viewer-follow-state'
import type { ViewerFollowState } from '@/lib/follows/viewer-follow-state'
import { getSeenTripIds, recordSeenTripIds } from '@/lib/seen-trip-store/storage'

describe('FlightFeedView empty state', () => {
  it('links to /countries, the actual browse-countries route, not a typo of it', () => {
    render(<FlightFeedView follows={{ status: 'resolved', followedPilotIds: [] }} defaultPilotId={4549} />)

    expect(
      screen.getByRole('link', { name: /browse clubs by country/i }).getAttribute('href'),
    ).toBe('/countries')
  })
})

describe('FlightFeedView follows-unavailable state', () => {
  it('renders a visible error notice, not the "follows nobody" empty state, when the follow list failed to load', () => {
    render(<FlightFeedView follows={{ status: 'follows-unavailable' }} defaultPilotId={4549} />)

    expect(screen.getByText("Couldn't load the pilots you follow right now.")).toBeTruthy()
    expect(screen.queryByText('Flights from pilots you follow show up here.')).toBeNull()
  })

  it('renders the ordinary content for a resolved, genuinely empty follow list', () => {
    render(<FlightFeedView follows={{ status: 'resolved', followedPilotIds: [] }} defaultPilotId={4549} />)

    expect(screen.queryByText("Couldn't load the pilots you follow right now.")).toBeNull()
  })
})

describe('FlightFeed branching on the viewer follow state', () => {
  const DEFAULT_PILOT_ID = 4549

  async function feedFor(follows: ViewerFollowState) {
    vi.mocked(resolveViewerFollowState).mockResolvedValue(follows)
    return FlightFeed({ defaultPilotId: DEFAULT_PILOT_ID })
  }

  it('renders SignedOutHome, not FlightFeedView, for a signed-out visitor', async () => {
    const element = await feedFor({ status: 'signed-out' })

    expect(element.type).toBe(SignedOutHome)
    expect(element.props).toEqual({ defaultPilotId: DEFAULT_PILOT_ID })
  })

  it.each<ViewerFollowState>([
    { status: 'resolved', followedPilotIds: [] },
    { status: 'resolved', followedPilotIds: [11, 12] },
    { status: 'follows-unavailable' },
  ])('renders FlightFeedView with the unchanged follows prop for %o', async (follows) => {
    const element = await feedFor(follows)

    expect(element.type).toBe(FlightFeedView)
    expect(element.props).toEqual({ follows, defaultPilotId: DEFAULT_PILOT_ID })
  })
})

// The round-1 blocker #155's own follow-up closed: pruning seen-trip-store against an empty
// stand-in for an unresolved follow list used to wipe every followed pilot's remembered set on a
// mere query failure. Seeded and read through the real store functions (recordSeenTripIds/
// getSeenTripIds), not raw localStorage — see follow-button/index.test.tsx's own doc comment on
// why: this store hydrates its in-memory cache lazily and never re-reads it, so a direct
// localStorage write could go unseen by a store instance a prior test in this file already
// hydrated.
describe('FlightFeedView seen-trip prune (#155 follow-up)', () => {
  const PRUNE_TEST_PILOT_ID = 8080

  beforeEach(() => {
    recordSeenTripIds(PRUNE_TEST_PILOT_ID, { fetchedTripIds: new Set([1]), renderedTripIds: new Set([1]) })
  })

  it('leaves the pruned pilot untouched when follows are unavailable, rather than pruning against an empty stand-in', () => {
    render(<FlightFeedView follows={{ status: 'follows-unavailable' }} defaultPilotId={4549} />)

    expect(getSeenTripIds(PRUNE_TEST_PILOT_ID)).not.toBeNull()
  })

  it('prunes a pilot who has fallen out of the resolved follow list once follows do resolve', () => {
    render(<FlightFeedView follows={{ status: 'resolved', followedPilotIds: [] }} defaultPilotId={4549} />)

    expect(getSeenTripIds(PRUNE_TEST_PILOT_ID)).toBeNull()
  })
})
