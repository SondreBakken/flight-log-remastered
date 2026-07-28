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
    render(<StatsLeaderboard stats={[]} />)
    screen.getByText(/no pilot stats recorded/i)
    expect(screen.queryByRole('table')).toBeNull()
  })

  // Must go RED if a stats row's follow button/link is ever rendered from the ambiguous
  // name-match case — this repo's own five-times-shipped "confident wrong answer" failure,
  // applied to club stats.
  it('gives a follow button and a pilot link only to a row whose name resolved unambiguously; the ambiguous row gets neither', () => {
    render(<StatsLeaderboard stats={ROWS} />)

    expect(screen.getByRole('link', { name: 'Low Flyer' }).getAttribute('href')).toBe('/pilots/1')
    expect(screen.getByRole('link', { name: 'High Flyer' }).getAttribute('href')).toBe('/pilots/2')
    expect(screen.queryByRole('link', { name: 'Ambiguous Name' })).toBeNull()
    screen.getByText('Ambiguous Name')

    expect(screen.getAllByRole('button', { name: /follow/i })).toHaveLength(2)
  })

  it('sorts descending by flights on the first click of the Flights header', () => {
    render(<StatsLeaderboard stats={ROWS} />)

    fireEvent.click(screen.getByRole('button', { name: /^flights/i }))

    expect(rowOrder()[0]).toContain('High Flyer')
  })

  it('flips to ascending on a second click of the same header', () => {
    render(<StatsLeaderboard stats={ROWS} />)

    const flightsHeader = screen.getByRole('button', { name: /^flights/i })
    fireEvent.click(flightsHeader)
    fireEvent.click(flightsHeader)

    expect(rowOrder()[0]).toContain('Low Flyer')
  })

  it('sorts by a different column (distance) independently of the flights sort', () => {
    render(<StatsLeaderboard stats={ROWS} />)

    fireEvent.click(screen.getByRole('button', { name: /distance/i }))

    expect(rowOrder()[0]).toContain('High Flyer')
  })
})
