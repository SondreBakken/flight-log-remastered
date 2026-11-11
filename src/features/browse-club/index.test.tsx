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
  updatedAt: '2026-02-14 13:52:15 Pilot Two',
}

describe('BrowseClub', () => {
  it('renders the club name, member count and the optional detail fields that are present', () => {
    render(
      <BrowseClub
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        roster={[]}
        stats={[]}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

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
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    expect(screen.queryByText('Coordinates')).toBeNull()
    expect(screen.queryByText('Link')).toBeNull()
  })

  it('lays every club detail field out label-above-value with form-label dts and no opacity classes', () => {
    const { container } = render(
      <BrowseClub
        countryId={160}
        countryName="Norway"
        detail={{ ...DETAIL, createdAt: '2025-01-02 10:00:00 Pilot One' }}
        roster={[]}
        stats={[]}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    const dl = container.querySelector('dl') as HTMLElement
    expect(dl.className).not.toMatch(/grid-cols|opacity-/)
    const dts = Array.from(dl.querySelectorAll('dt'))
    expect(dts.map((dt) => dt.textContent)).toEqual(['Members', 'Description', 'Coordinates', 'Link', 'Created', 'Updated'])
    for (const dt of dts) {
      expect(dt.className).toBe('form-label')
      expect(dt.parentElement?.tagName).toBe('DIV')
      expect(dt.nextElementSibling?.tagName).toBe('DD')
    }
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect(a.className).not.toMatch(/underline|opacity-/)
    }
  })

  // Must go RED if the roster-rendering path is ever built by joining stats onto the roster
  // instead of rendering the roster directly: a member with no stats row would silently
  // disappear.
  it('renders a roster member who has never flown (no matching stats row) with a follow button, not dropped', () => {
    const roster: ClubMember[] = [{ userId: 1, name: 'Never Flew' }]
    render(
      <BrowseClub
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        roster={roster}
        stats={[]}
        isSignedIn
        followedPilotIds={[]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Never Flew' }).getAttribute('href')).toBe('/pilots/1')
    expect(screen.getAllByRole('button', { name: /follow/i })).toHaveLength(1)
  })

  it('gives every roster row a follow button unconditionally, regardless of the stats leaderboard', () => {
    const roster: ClubMember[] = [
      { userId: 1, name: 'Pilot One' },
      { userId: 2, name: 'Never Flew' },
    ]
    const stats: ClubPilotStats[] = [{ name: 'Pilot One', flights: 14, distanceKm: 0, hours: 1.1 }]

    render(
      <BrowseClub
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        roster={roster}
        stats={stats}
        isSignedIn
        followedPilotIds={[]}
      />,
    )

    // Two roster follow buttons plus one leaderboard follow button (Pilot One resolves
    // unambiguously) — three total, not two.
    expect(screen.getAllByRole('button', { name: /follow/i })).toHaveLength(3)
  })

  it('marks a roster follow button as already-followed when its pilot id is in followedPilotIds', () => {
    const roster: ClubMember[] = [{ userId: 1, name: 'Already Followed' }]
    render(
      <BrowseClub
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        roster={roster}
        stats={[]}
        isSignedIn
        followedPilotIds={[1]}
      />,
    )

    expect(screen.getByRole('button', { name: 'Following' })).toBeTruthy()
  })

  it('renders exactly one sign-in prompt, not a link per row in either list, when signed out', () => {
    const roster: ClubMember[] = [
      { userId: 1, name: 'Never Flew' },
      { userId: 2, name: 'Pilot Two' },
    ]
    const stats: ClubPilotStats[] = [{ name: 'Pilot Two', flights: 4, distanceKm: 12, hours: 3 }]
    render(
      <BrowseClub
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        roster={roster}
        stats={stats}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    expect(screen.queryByRole('button', { name: /follow/i })).toBeNull()
    const prompts = screen.getAllByRole('link', { name: /sign in to follow/i })
    expect(prompts).toHaveLength(1)
    expect(prompts[0].getAttribute('href')).toBe('/sign-in')
  })

  it('renders no sign-in prompt for an empty roster when signed out', () => {
    render(
      <BrowseClub
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        roster={[]}
        stats={[]}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull()
    screen.getByText(/no members recorded/i)
  })

  it('never renders the sign-in prompt when signed in', () => {
    render(
      <BrowseClub
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        roster={[{ userId: 1, name: 'Never Flew' }]}
        stats={[]}
        isSignedIn
        followedPilotIds={[]}
      />,
    )

    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull()
  })

  it('renders the empty-roster state, not an empty list, for a real club with zero members', () => {
    const { container } = render(
      <BrowseClub
        countryId={160}
        countryName="Norway"
        detail={{ ...DETAIL, memberCount: 0 }}
        roster={[]}
        stats={[]}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    screen.getByText(/no members recorded/i)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('shows a leading icon on the back-to-clubs link', () => {
    const { container } = render(
      <BrowseClub countryId={160} countryName="Norway" detail={DETAIL} roster={[]} stats={[]} isSignedIn={false} followedPilotIds={[]} />,
    )

    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('shows a trailing icon on the "View on map" link', () => {
    const { container } = render(
      <BrowseClub countryId={160} countryName="Norway" detail={DETAIL} roster={[]} stats={[]} isSignedIn={false} followedPilotIds={[]} />,
    )

    expect(screen.getByRole('link', { name: /view on map/i })).toBeTruthy()
    expect(container.querySelector('a svg')).toBeTruthy()
  })
})
