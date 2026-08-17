import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { FeedEntryRow } from '@/features/browse-flight-feed/components/feed-entry-row'
import type { FeedEntry } from '@/features/browse-flight-feed/feed'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Cell-scoped, not document-scoped: getByText anywhere in the document would still pass
// if two field values swapped table cells. Indexing into row cells makes column order
// part of what the test asserts.
//
// Named for BOTH things it does, not just the render: it also unmounts whatever a PRIOR call
// in the same test left behind — without that, the badge test below (which calls this three
// times to compare newness states) would accumulate multiple <table> rows in the document, and
// screen.getByRole('button') would throw "multiple elements found" instead of returning the row
// just rendered (the row carries role="button", not the implicit "row", since it's now the
// click/keydown navigation target — see FeedEntryRow).
function remountRow(entry: FeedEntry) {
  cleanup()
  render(
    <table>
      <tbody>
        <FeedEntryRow entry={entry} />
      </tbody>
    </table>,
  )
  return within(screen.getByRole('button')).getAllByRole('cell')
}

const baseEntry: FeedEntry = {
  pilot: { userId: 42, name: 'Ada Lovelace', country: null, club: null },
  flight: {
    tripId: 501,
    userId: 42,
    date: '2026-05-01',
    country: null,
    takeoff: 'Voss',
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

beforeEach(() => {
  mockPush.mockClear()
})

describe('FeedEntryRow', () => {
  it('renders the date, pilot link, and formatted flight fields in column order, plus "View track" text when a track exists', () => {
    const [dateCell, pilotCell, takeoffCell, durationCell, distanceCell, trackCell] = remountRow(baseEntry)

    expect(dateCell.textContent).toBe('2026-05-01')

    const pilotLink = within(pilotCell).getByRole('link', { name: 'Ada Lovelace' })
    expect(pilotLink.getAttribute('href')).toBe('/pilots/42')

    expect(takeoffCell.textContent).toBe('Voss')
    expect(durationCell.textContent).toBe('2:15')
    expect(distanceCell.textContent).toBe('38.4 km')
    expect(trackCell.textContent).toBe('View track')
  })

  it('renders "none" instead of "View track" when the flight has no track', () => {
    const cells = remountRow({ ...baseEntry, hasTrack: false, newness: 'not-new', trackedAt: null })
    const trackCell = cells[5]

    expect(trackCell.textContent).toBe('none')
  })

  it('shows a "New" badge only when newness is \'new\', never for \'not-new\' (issue #5, extended to untracked flights by #62)', () => {
    const [newDateCell] = remountRow({ ...baseEntry, newness: 'new' })
    expect(within(newDateCell).queryByText('New')).not.toBeNull()

    const [notNewDateCell] = remountRow({ ...baseEntry, newness: 'not-new' })
    expect(within(notNewDateCell).queryByText('New')).toBeNull()

    const [untrackedNotNewDateCell] = remountRow({ ...baseEntry, hasTrack: false, newness: 'not-new', trackedAt: null })
    expect(within(untrackedNotNewDateCell).queryByText('New')).toBeNull()

    const [untrackedNewDateCell] = remountRow({ ...baseEntry, hasTrack: false, newness: 'new', trackedAt: null })
    expect(within(untrackedNewDateCell).queryByText('New')).not.toBeNull()
  })

  // #217, porting #213/#214's row-navigation pattern: the whole row is the click target now,
  // not just a Track cell link, so untracked rows (the majority) can reach their flight page too.
  it('navigates to the flight page when an untracked row is clicked anywhere', () => {
    remountRow({ ...baseEntry, hasTrack: false, newness: 'not-new', trackedAt: null })

    fireEvent.click(screen.getByRole('button'))

    expect(mockPush).toHaveBeenCalledWith('/flights/501')
  })

  it('navigates to the flight page when a tracked row is clicked anywhere', () => {
    remountRow(baseEntry)

    fireEvent.click(screen.getByRole('button'))

    expect(mockPush).toHaveBeenCalledWith('/flights/501')
  })

  it('navigates on Enter and Space, for keyboard users who cannot click', () => {
    remountRow(baseEntry)
    const row = screen.getByRole('button')

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })

    expect(mockPush).toHaveBeenCalledTimes(2)
    expect(mockPush).toHaveBeenCalledWith('/flights/501')
  })

  // Mirrors the tracked-row case above for an untracked entry (hasTrack: false) — most flights
  // are untracked (#217's actual motivating case), and onKeyDown is attached to the row
  // unconditionally, but nothing previously proved keyboard navigation actually reaches an
  // untracked row too.
  it('navigates on Enter and Space for an untracked row, for keyboard users who cannot click', () => {
    remountRow({ ...baseEntry, hasTrack: false, newness: 'not-new', trackedAt: null })
    const row = screen.getByRole('button')

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })

    expect(mockPush).toHaveBeenCalledTimes(2)
    expect(mockPush).toHaveBeenCalledWith('/flights/501')
  })

  it('does not navigate on an unrelated keypress', () => {
    remountRow(baseEntry)
    const row = screen.getByRole('button')

    fireEvent.keyDown(row, { key: 'Tab' })

    expect(mockPush).not.toHaveBeenCalled()
  })

  // The whole-row click handler and the nested pilot link both sit on the same row; without
  // stopping propagation on the link's click, clicking the pilot name would ALSO push to the
  // flight page — the one behavior genuinely new to this port vs. flight-row.tsx, which has no
  // nested interactive elements at all.
  it('does not navigate to the flight page when the nested pilot link is clicked', () => {
    const [, pilotCell] = remountRow(baseEntry)
    const pilotLink = within(pilotCell).getByRole('link', { name: 'Ada Lovelace' })

    fireEvent.click(pilotLink)

    expect(mockPush).not.toHaveBeenCalled()
  })

  // keydown bubbles from the pilot link up to the row's handler, unlike click (which the
  // pilot link's own onClick stops from propagating). Without a target check in handleKeyDown,
  // Enter on the focused pilot link would preventDefault() the link's native activation and
  // navigate to the flight page instead of /pilots/{userId} — the review gap #217 was reopened
  // for.
  it('does not navigate to the flight page when Enter or Space is pressed on the nested pilot link', () => {
    const [, pilotCell] = remountRow(baseEntry)
    const pilotLink = within(pilotCell).getByRole('link', { name: 'Ada Lovelace' })

    fireEvent.keyDown(pilotLink, { key: 'Enter' })
    fireEvent.keyDown(pilotLink, { key: ' ' })

    expect(mockPush).not.toHaveBeenCalled()
  })

  // Proves the RIGHT thing, not just the absence of the wrong thing: the previous test only
  // pins that mockPush isn't called, which a mutation that hoists handleKeyDown's
  // preventDefault() above the `event.target !== event.currentTarget` guard would still pass
  // (it still bails before navigateToFlight(), but has already called preventDefault() on the
  // bubbled event by then). That hoisted preventDefault() cancels the pilot link's native Enter
  // activation, making /pilots/{userId} unreachable by keyboard with no test catching it.
  // createEvent (rather than fireEvent) is used so the event object survives dispatch and its
  // defaultPrevented flag can be inspected afterwards.
  it('does not prevent the pilot link\'s own native activation when Enter is pressed on it', () => {
    const [, pilotCell] = remountRow(baseEntry)
    const pilotLink = within(pilotCell).getByRole('link', { name: 'Ada Lovelace' })

    const keyDownEvent = createEvent.keyDown(pilotLink, { key: 'Enter' })
    fireEvent(pilotLink, keyDownEvent)

    expect(keyDownEvent.defaultPrevented).toBe(false)
  })
})
