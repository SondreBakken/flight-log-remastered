import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeedEntryRow } from '@/features/browse-flight-feed/components/feed-entry-row'
import type { FeedEntry } from '@/features/browse-flight-feed/feed'

function renderRow(entry: FeedEntry) {
  return render(
    <table>
      <tbody>
        <FeedEntryRow entry={entry} />
      </tbody>
    </table>,
  )
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
  it('renders a pilot link, the formatted flight fields, and a track link when a track exists', () => {
    renderRow(baseEntry)

    const pilotLink = screen.getByRole('link', { name: 'Ada Lovelace' })
    expect(pilotLink.getAttribute('href')).toBe('/pilots/42')

    expect(screen.getByText('Voss')).toBeDefined()
    expect(screen.getByText('2:15')).toBeDefined()
    expect(screen.getByText('38.4 km')).toBeDefined()

    const trackLink = screen.getByRole('link', { name: 'View track' })
    expect(trackLink.getAttribute('href')).toBe('/flights/501')
  })

  it('renders "none" instead of a track link when the flight has no track', () => {
    renderRow({ ...baseEntry, hasTrack: false })

    expect(screen.queryByRole('link', { name: 'View track' })).toBeNull()
    expect(screen.getByText('none')).toBeDefined()
  })
})
