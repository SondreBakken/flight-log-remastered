import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { FeedEntryRow } from '@/features/browse-flight-feed/components/feed-entry-row'
import type { FeedEntry } from '@/features/browse-flight-feed/feed'

// Cell-scoped, not document-scoped: getByText anywhere in the document would still pass
// if two field values swapped table cells. Indexing into row cells makes column order
// part of what the test asserts.
function renderRow(entry: FeedEntry) {
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
}

describe('FeedEntryRow', () => {
  it('renders the date, pilot link, and formatted flight fields in column order, plus a track link when a track exists', () => {
    const [dateCell, pilotCell, takeoffCell, durationCell, distanceCell, trackCell] = renderRow(baseEntry)

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
    const cells = renderRow({ ...baseEntry, hasTrack: false })
    const trackCell = cells[5]

    expect(within(trackCell).queryByRole('link', { name: 'View track' })).toBeNull()
    expect(trackCell.textContent).toBe('none')
  })
})
