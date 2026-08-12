import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlightFeedView } from './index'
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

  it('renders the ordinary empty state for a signed-out visitor too, same as a resolved empty list', () => {
    render(<FlightFeedView follows={{ status: 'signed-out' }} defaultPilotId={4549} />)

    expect(screen.queryByText("Couldn't load the pilots you follow right now.")).toBeNull()
    expect(screen.getByText('Flights from pilots you follow show up here.')).toBeTruthy()
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
