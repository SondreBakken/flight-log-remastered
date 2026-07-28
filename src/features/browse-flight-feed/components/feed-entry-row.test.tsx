import { describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { FeedEntryRow } from '@/features/browse-flight-feed/components/feed-entry-row'
import type { FeedEntry } from '@/features/browse-flight-feed/feed'

// Cell-scoped, not document-scoped: getByText anywhere in the document would still pass
// if two field values swapped table cells. Indexing into row cells makes column order
// part of what the test asserts.
//
// Named for BOTH things it does, not just the render: it also unmounts whatever a PRIOR call
// in the same test left behind — without that, the badge test below (which calls this three
// times to compare newness states) would accumulate multiple <table> rows in the document, and
// screen.getByRole('row') would throw "multiple elements found" instead of returning the row
// just rendered.
function remountRow(entry: FeedEntry) {
  cleanup()
  render(
    <table>
      <tbody>
        <FeedEntryRow entry={entry} />
      </tbody>
    </table>,
  )
  return within(screen.getByRole('row')).getAllByRole('cell')
}

const baseEntry: FeedEntry = {
  pilot: { userId: 42, name: 'Ada Lovelace', country: null, club: null },
  flight: {
    tripId: 501,
    userId: 42,
    date: '2026-05-01',
    country: null,
    takeoff: 'Voss',
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

describe('FeedEntryRow', () => {
  it('renders the date, pilot link, and formatted flight fields in column order, plus a track link when a track exists', () => {
    const [dateCell, pilotCell, takeoffCell, durationCell, distanceCell, trackCell] = remountRow(baseEntry)

    expect(dateCell.textContent).toBe('2026-05-01')

    const pilotLink = within(pilotCell).getByRole('link', { name: 'Ada Lovelace' })
    expect(pilotLink.getAttribute('href')).toBe('/pilots/42')

    expect(takeoffCell.textContent).toBe('Voss')
    expect(durationCell.textContent).toBe('2:15')
    expect(distanceCell.textContent).toBe('38.4 km')

    const trackLink = within(trackCell).getByRole('link', { name: 'View track' })
    expect(trackLink.getAttribute('href')).toBe('/flights/501')
  })

  it('renders "none" instead of a track link when the flight has no track', () => {
    const cells = remountRow({ ...baseEntry, hasTrack: false, newness: 'unknown', trackedAt: null })
    const trackCell = cells[5]

    expect(within(trackCell).queryByRole('link', { name: 'View track' })).toBeNull()
    expect(trackCell.textContent).toBe('none')
  })

  it('shows a "New" badge only when newness is \'new\', never for \'not-new\' or \'unknown\' (issue #5)', () => {
    const [newDateCell] = remountRow({ ...baseEntry, newness: 'new' })
    expect(within(newDateCell).queryByText('New')).not.toBeNull()

    const [notNewDateCell] = remountRow({ ...baseEntry, newness: 'not-new' })
    expect(within(notNewDateCell).queryByText('New')).toBeNull()

    const [unknownDateCell] = remountRow({ ...baseEntry, hasTrack: false, newness: 'unknown', trackedAt: null })
    expect(within(unknownDateCell).queryByText('New')).toBeNull()
  })
})
