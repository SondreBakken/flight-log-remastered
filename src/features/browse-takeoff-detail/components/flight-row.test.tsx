import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { TakeoffFlightRow } from '@/features/browse-takeoff-detail/components/flight-row'
import type { TakeoffFlight } from '@/lib/flightlog/types'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Unmounts whatever a prior call left behind, same reasoning as feed-entry-row.test.tsx's own
// remountRow. Returns the <tr> itself directly, rather than screen.getByRole('button') — unlike
// FeedEntryRow, this row's own FollowButton also renders a <button> when signed in, so two
// elements share role="button" here and querying by role alone would be ambiguous.
function remountRow(flight: TakeoffFlight, isFollowed = false, isSignedIn = true) {
  cleanup()
  const { container } = render(
    <table>
      <tbody>
        <TakeoffFlightRow flight={flight} isFollowed={isFollowed} isSignedIn={isSignedIn} />
      </tbody>
    </table>,
  )
  return container.querySelector('tr') as HTMLTableRowElement
}

const BASE_FLIGHT: TakeoffFlight = {
  tripId: 1000946,
  userId: 3365,
  pilotName: 'Jarl Christian Kind',
  club: 'Pyongyang Freedom Fighters',
  glider: 'Gin Camino M',
  duration: '02:41',
  distanceKm: 28,
  note: 'Good flight',
  date: '2026-07-17',
  timeOfDay: '10:52',
}

beforeEach(() => {
  mockPush.mockClear()
})

describe('TakeoffFlightRow', () => {
  it('navigates to the flight page when the row is clicked anywhere', () => {
    const row = remountRow(BASE_FLIGHT)

    fireEvent.click(row)

    expect(mockPush).toHaveBeenCalledWith('/flights/1000946')
  })

  it('navigates on Enter and Space, for keyboard users who cannot click', () => {
    const row = remountRow(BASE_FLIGHT)

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })

    expect(mockPush).toHaveBeenCalledTimes(2)
    expect(mockPush).toHaveBeenCalledWith('/flights/1000946')
  })

  it('does not navigate on an unrelated keypress', () => {
    const row = remountRow(BASE_FLIGHT)

    fireEvent.keyDown(row, { key: 'Tab' })

    expect(mockPush).not.toHaveBeenCalled()
  })

  // The whole-row click handler and the nested pilot link both sit on the same row; without
  // stopping propagation on the wrapping div around the pilot link and FollowButton, clicking
  // the pilot name would ALSO push to the flight page.
  it('does not navigate to the flight page when the nested pilot link is clicked', () => {
    remountRow(BASE_FLIGHT)
    const pilotLink = screen.getByRole('link', { name: 'Jarl Christian Kind' })

    fireEvent.click(pilotLink)

    expect(mockPush).not.toHaveBeenCalled()
  })

  // createEvent (rather than fireEvent) is used so the event objects survive dispatch and their
  // defaultPrevented flag can be inspected afterwards — mockPush not being called alone wouldn't
  // catch a preventDefault() hoisted above handleKeyDown's target-check guard, which would cancel
  // the pilot link's own native activation while still bailing before navigateToFlight() (see
  // feed-entry-row.test.tsx's sibling assertion for the same gap, #217).
  it('does not navigate to the flight page when Enter or Space is pressed on the nested pilot link', () => {
    remountRow(BASE_FLIGHT)
    const pilotLink = screen.getByRole('link', { name: 'Jarl Christian Kind' })

    const enterEvent = createEvent.keyDown(pilotLink, { key: 'Enter' })
    fireEvent(pilotLink, enterEvent)
    const spaceEvent = createEvent.keyDown(pilotLink, { key: ' ' })
    fireEvent(pilotLink, spaceEvent)

    expect(mockPush).not.toHaveBeenCalled()
    expect(enterEvent.defaultPrevented).toBe(false)
    expect(spaceEvent.defaultPrevented).toBe(false)
  })

  // FollowButton has no onClick prop of its own to hook stopPropagation into — propagation is
  // stopped on the wrapping div instead (see flight-row.tsx's own doc comment), so this pins
  // that the follow button itself is also protected, not just the pilot link beside it.
  it('does not navigate to the flight page when the follow button is clicked', () => {
    remountRow(BASE_FLIGHT, false, true)
    const followButton = screen.getByRole('button', { name: 'Follow' })

    fireEvent.click(followButton)

    expect(mockPush).not.toHaveBeenCalled()
  })

  it('renders "View track" as plain text, not a link, now that the whole row navigates', () => {
    remountRow(BASE_FLIGHT)

    expect(screen.getByText('View track').tagName).not.toBe('A')
    expect(screen.queryByRole('link', { name: 'View track' })).toBeNull()
  })

  // A role="button" element gets no native activation from the browser, but Space still
  // triggers its default action for a role="button" — scrolling the page — unless
  // preventDefault() is called.
  it('prevents the default Space action (page scroll) when Space is pressed on the row', () => {
    const row = remountRow(BASE_FLIGHT)

    const keyDownEvent = createEvent.keyDown(row, { key: ' ' })
    fireEvent(row, keyDownEvent)

    expect(keyDownEvent.defaultPrevented).toBe(true)
  })
})
