import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import BrowseClub from './index'
import type { ClubDetail, ClubMember, ClubPilotStats } from '@/lib/flightlog/types'

const DETAIL: ClubDetail = {
  clubId: 51,
  name: 'Voss Hang- Og Paragliderklubb',
  memberCount: 2,
  coordinatesText: "DMS: N 60° 38' 25''",
  mapUrl: 'https://earth.google.com/web/search/60.6,6.5',
  description: 'Lokalisert på Voss',
  linkUrl: 'https://www.vosshpk.no',
  createdAt: null,
  updatedAt: '2026-02-14 13:52:15 Martin Krossoy',
}

describe('BrowseClub', () => {
  it('renders the club name, member count and the optional detail fields that are present', () => {
    render(<BrowseClub countryId={160} countryName="Norway" detail={DETAIL} roster={[]} stats={[]} />)

    screen.getByRole('heading', { name: 'Voss Hang- Og Paragliderklubb', level: 1 })
    screen.getByText('2')
    screen.getByText('Lokalisert på Voss')
    expect(screen.getByRole('link', { name: 'https://www.vosshpk.no' }).getAttribute('href')).toBe('https://www.vosshpk.no')
    expect(screen.getByRole('link', { name: /view on map/i }).getAttribute('href')).toBe(DETAIL.mapUrl)
  })

  it('omits an optional detail field entirely rather than rendering an empty row when it is absent', () => {
    render(
      <BrowseClub
        countryId={160}
        countryName="Norway"
        detail={{ ...DETAIL, linkUrl: null, coordinatesText: null, mapUrl: null }}
        roster={[]}
        stats={[]}
      />,
    )

    expect(screen.queryByText('Coordinates')).toBeNull()
    expect(screen.queryByText('Link')).toBeNull()
  })

  // Must go RED if the roster-rendering path is ever built by joining stats onto the roster
  // instead of rendering the roster directly: a member with no stats row would silently
  // disappear.
  it('renders a roster member who has never flown (no matching stats row) with a follow button, not dropped', () => {
    const roster: ClubMember[] = [{ userId: 1, name: 'Never Flew' }]
    render(<BrowseClub countryId={160} countryName="Norway" detail={DETAIL} roster={roster} stats={[]} />)

    expect(screen.getByRole('link', { name: 'Never Flew' }).getAttribute('href')).toBe('/pilots/1')
    expect(screen.getAllByRole('button', { name: /follow/i })).toHaveLength(1)
  })

  it('gives every roster row a follow button unconditionally, regardless of the stats leaderboard', () => {
    const roster: ClubMember[] = [
      { userId: 1, name: 'Ade Hawkins' },
      { userId: 2, name: 'Never Flew' },
    ]
    const stats: ClubPilotStats[] = [{ name: 'Ade Hawkins', flights: 14, distanceKm: 0, hours: 1.1 }]

    render(<BrowseClub countryId={160} countryName="Norway" detail={DETAIL} roster={roster} stats={stats} />)

    // Two roster follow buttons plus one leaderboard follow button (Ade Hawkins resolves
    // unambiguously) — three total, not two.
    expect(screen.getAllByRole('button', { name: /follow/i })).toHaveLength(3)
  })

  it('renders the empty-roster state, not an empty list, for a real club with zero members', () => {
    render(<BrowseClub countryId={160} countryName="Norway" detail={{ ...DETAIL, memberCount: 0 }} roster={[]} stats={[]} />)

    screen.getByText(/no members recorded/i)
  })
})
