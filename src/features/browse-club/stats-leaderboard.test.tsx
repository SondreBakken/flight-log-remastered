import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StatsLeaderboard } from './stats-leaderboard'
import type { ResolvedClubStats } from './resolve-stats-pilots'

const ROWS: ResolvedClubStats[] = [
  { name: 'Low Flyer', flights: 2, distanceKm: 5, hours: 20, userId: 1 },
  { name: 'High Flyer', flights: 40, distanceKm: 300, hours: 5, userId: 2 },
  { name: 'Ambiguous Name', flights: 3, distanceKm: 10, hours: 2, userId: null },
]

function rowOrder(): string[] {
  return screen.getAllByRole('row').slice(1).map((row) => row.textContent ?? '')
}

describe('StatsLeaderboard', () => {
  it('renders the empty state, not a table, when there are no stats rows', () => {
    render(<StatsLeaderboard stats={[]} isSignedIn={false} followedPilotIds={[]} />)
    screen.getByText(/no pilot stats recorded/i)
    expect(screen.queryByRole('table')).toBeNull()
  })

  // Must go RED if a stats row's follow button/link is ever rendered from the ambiguous
  // name-match case — this repo's own five-times-shipped "confident wrong answer" failure,
  // applied to club stats.
  it('gives a follow button and a pilot link only to a row whose name resolved unambiguously; the ambiguous row gets neither', () => {
    render(<StatsLeaderboard stats={ROWS} isSignedIn followedPilotIds={[]} />)

    expect(screen.getByRole('link', { name: 'Low Flyer' }).getAttribute('href')).toBe('/pilots/1')
    expect(screen.getByRole('link', { name: 'High Flyer' }).getAttribute('href')).toBe('/pilots/2')
    expect(screen.queryByRole('link', { name: 'Ambiguous Name' })).toBeNull()
    screen.getByText('Ambiguous Name')

    expect(screen.getAllByRole('button', { name: /follow/i })).toHaveLength(2)
  })

  // A bare `title` attribute alone is invisible on touch, never focusable, and not announced
  // by a screen reader — the ambiguous row must carry a second, always-present affordance
  // explaining why it has no link, not just a hover-only one.
  it('gives the ambiguous row a screen-reader-visible explanation for why it has no profile link, not just a hover title', () => {
    render(<StatsLeaderboard stats={ROWS} isSignedIn followedPilotIds={[]} />)

    expect(screen.getByText(/no pilot profile link available/i)).not.toBeNull()
  })

  it('marks a row as already-followed when its userId is in followedPilotIds', () => {
    render(<StatsLeaderboard stats={ROWS} isSignedIn followedPilotIds={[1]} />)

    expect(screen.getByRole('button', { name: 'Following' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Follow' })).toBeTruthy()
  })

  it('renders a sign-in prompt instead of follow buttons when signed out', () => {
    render(<StatsLeaderboard stats={ROWS} isSignedIn={false} followedPilotIds={[]} />)

    expect(screen.queryByRole('button', { name: /follow/i })).toBeNull()
    expect(screen.getAllByRole('link', { name: /sign in to follow/i })).toHaveLength(2)
  })

  it('defaults to sorted descending by flights, with the Flights header reflecting that, before any click', () => {
    render(<StatsLeaderboard stats={ROWS} isSignedIn followedPilotIds={[]} />)

    expect(rowOrder()[0]).toContain('High Flyer')
    expect(screen.getByRole('columnheader', { name: /^flights/i }).getAttribute('aria-sort')).toBe('descending')
  })

  it('flips to ascending on a click of the already-sorted Flights header', () => {
    render(<StatsLeaderboard stats={ROWS} isSignedIn followedPilotIds={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /^flights/i }))

    expect(rowOrder()[0]).toContain('Low Flyer')
    expect(screen.getByRole('columnheader', { name: /^flights/i }).getAttribute('aria-sort')).toBe('ascending')
  })

  it('sorts by a different column (distance) independently of the flights sort', () => {
    render(<StatsLeaderboard stats={ROWS} isSignedIn followedPilotIds={[]} />)

    fireEvent.click(screen.getByRole('button', { name: /distance/i }))

    expect(rowOrder()[0]).toContain('High Flyer')
    expect(screen.getByRole('columnheader', { name: /distance/i }).getAttribute('aria-sort')).toBe('descending')
    expect(screen.getByRole('columnheader', { name: /^flights/i }).getAttribute('aria-sort')).toBe('none')
  })
})
