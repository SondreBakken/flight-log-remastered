import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, within } from '@testing-library/react'
import { FeedEntryRow } from '@/features/browse-flight-feed/components/feed-entry-row'
import type { FeedEntry } from '@/features/browse-flight-feed/feed'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Unmounts whatever a PRIOR call in the same test left behind — without that, the badge test
// below (which calls this three times to compare newness states) would accumulate multiple
// <table> rows in the document. Selects via container.querySelector('tr') rather than
// screen.getByRole('button'): the row no longer carries role="button" (#221 — that role is
// ARIA-invalid on a row nesting the interactive pilot link), same selection strategy
// browse-takeoff-detail/components/flight-row.test.tsx already uses for its own <tr>.
function remountRow(entry: FeedEntry) {
  cleanup()
  const { container } = render(
    <table>
      <tbody>
        <FeedEntryRow entry={entry} />
      </tbody>
    </table>,
  )
  return container.querySelector('tr') as HTMLTableRowElement
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
    const row = remountRow(baseEntry)
    const [dateCell, pilotCell, takeoffCell, durationCell, distanceCell, trackCell] = within(row).getAllByRole('cell')

    expect(dateCell.textContent).toBe('2026-05-01')

    const pilotLink = within(pilotCell).getByRole('link', { name: 'Ada Lovelace' })
    expect(pilotLink.getAttribute('href')).toBe('/pilots/42')

    expect(takeoffCell.textContent).toBe('Voss')
    expect(durationCell.textContent).toBe('2:15')
    expect(distanceCell.textContent).toBe('38.4 km')
    expect(trackCell.textContent).toBe('View track')
  })

  it('renders "none" instead of "View track" when the flight has no track', () => {
    const row = remountRow({ ...baseEntry, hasTrack: false, newness: 'not-new', trackedAt: null })
    const cells = within(row).getAllByRole('cell')
    const trackCell = cells[5]

    expect(trackCell.textContent).toBe('none')
  })

  it('shows a "New" badge only when newness is \'new\', never for \'not-new\' (issue #5, extended to untracked flights by #62)', () => {
    const [newDateCell] = within(remountRow({ ...baseEntry, newness: 'new' })).getAllByRole('cell')
    expect(within(newDateCell).queryByText('New')).not.toBeNull()

    const [notNewDateCell] = within(remountRow({ ...baseEntry, newness: 'not-new' })).getAllByRole('cell')
    expect(within(notNewDateCell).queryByText('New')).toBeNull()

    const [untrackedNotNewDateCell] = within(
      remountRow({ ...baseEntry, hasTrack: false, newness: 'not-new', trackedAt: null }),
    ).getAllByRole('cell')
    expect(within(untrackedNotNewDateCell).queryByText('New')).toBeNull()

    const [untrackedNewDateCell] = within(
      remountRow({ ...baseEntry, hasTrack: false, newness: 'new', trackedAt: null }),
    ).getAllByRole('cell')
    expect(within(untrackedNewDateCell).queryByText('New')).not.toBeNull()
  })

  // #217, porting #213/#214's row-navigation pattern: the whole row is the click target now,
  // not just a Track cell link, so untracked rows (the majority) can reach their flight page too.
  it('navigates to the flight page when an untracked row is clicked anywhere', () => {
    const row = remountRow({ ...baseEntry, hasTrack: false, newness: 'not-new', trackedAt: null })

    fireEvent.click(row)

    expect(mockPush).toHaveBeenCalledWith('/flights/501')
  })

  it('navigates to the flight page when a tracked row is clicked anywhere', () => {
    const row = remountRow(baseEntry)

    fireEvent.click(row)

    expect(mockPush).toHaveBeenCalledWith('/flights/501')
  })

  it('navigates on Enter and Space, for keyboard users who cannot click', () => {
    const row = remountRow(baseEntry)

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
    const row = remountRow({ ...baseEntry, hasTrack: false, newness: 'not-new', trackedAt: null })

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })

    expect(mockPush).toHaveBeenCalledTimes(2)
    expect(mockPush).toHaveBeenCalledWith('/flights/501')
  })

  it('does not navigate on an unrelated keypress', () => {
    const row = remountRow(baseEntry)

    fireEvent.keyDown(row, { key: 'Tab' })

    expect(mockPush).not.toHaveBeenCalled()
  })

  // The whole-row click handler and the nested pilot link both sit on the same row; without
  // stopping propagation on the link's click, clicking the pilot name would ALSO push to the
  // flight page — the one behavior genuinely new to this port vs. flight-row.tsx, which has no
  // nested interactive elements at all.
  it('does not navigate to the flight page when the nested pilot link is clicked', () => {
    const row = remountRow(baseEntry)
    const [, pilotCell] = within(row).getAllByRole('cell')
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
    const row = remountRow(baseEntry)
    const [, pilotCell] = within(row).getAllByRole('cell')
    const pilotLink = within(pilotCell).getByRole('link', { name: 'Ada Lovelace' })

    fireEvent.keyDown(pilotLink, { key: 'Enter' })
    fireEvent.keyDown(pilotLink, { key: ' ' })

    expect(mockPush).not.toHaveBeenCalled()
  })

  // Proves the RIGHT thing, not just the absence of the wrong thing: the previous test only
  // pins that mockPush isn't called, which a mutation that hoists handleKeyDown's
  // preventDefault() above the `event.target !== event.currentTarget` guard would still pass
  // (it still bails before navigateToFlight(), but has already called preventDefault() on the
  // bubbled event by then). That hoisted preventDefault() cancels the pilot link's native
  // Enter/Space activation, making /pilots/{userId} unreachable by keyboard with no test catching
  // it — including a mutant that only hoists preventDefault() for the Space key, which the
  // Enter-only assertion alone would miss (#227). createEvent (rather than fireEvent) is used so
  // the event objects survive dispatch and their defaultPrevented flag can be inspected afterwards.
  it('does not prevent the pilot link\'s own native activation when Enter or Space is pressed on it', () => {
    const row = remountRow(baseEntry)
    const [, pilotCell] = within(row).getAllByRole('cell')
    const pilotLink = within(pilotCell).getByRole('link', { name: 'Ada Lovelace' })

    const keyDownEvent = createEvent.keyDown(pilotLink, { key: 'Enter' })
    fireEvent(pilotLink, keyDownEvent)
    const spaceEvent = createEvent.keyDown(pilotLink, { key: ' ' })
    fireEvent(pilotLink, spaceEvent)

    expect(keyDownEvent.defaultPrevented).toBe(false)
    expect(spaceEvent.defaultPrevented).toBe(false)
  })

  // The row has no native semantics that would suppress Space's default browser action
  // (page scroll) on its own — only the row's own preventDefault() in handleKeyDown does that.
  it('prevents the default Space action (page scroll) when Space is pressed on the row', () => {
    const row = remountRow(baseEntry)

    const keyDownEvent = createEvent.keyDown(row, { key: ' ' })
    fireEvent(row, keyDownEvent)

    expect(keyDownEvent.defaultPrevented).toBe(true)
  })

  // #221: role="button" was removed from the row since it can't validly hold that role while
  // nesting the interactive pilot link. aria-label carries the "this row is actionable" signal
  // instead, without asserting a role the markup can't validly hold.
  it('exposes an aria-label on the row instead of an invalid role="button"', () => {
    const row = remountRow(baseEntry)

    expect(row.getAttribute('role')).toBeNull()
    expect(row.getAttribute('aria-label')).toBe('View flight details')
  })
})
