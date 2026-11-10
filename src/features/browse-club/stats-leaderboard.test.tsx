import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StatsLeaderboard } from './stats-leaderboard'
import { MISSING_VALUE } from '@/lib/flightlog/format-flight'
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

  it('renders no follow buttons, sign-in links or Follow column when signed out, and keeps the stats', () => {
    render(<StatsLeaderboard stats={ROWS} isSignedIn={false} followedPilotIds={[]} />)

    expect(screen.queryByRole('button', { name: /follow/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /sign in to follow/i })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Follow' })).toBeNull()
    expect(rowOrder()).toHaveLength(3)
    screen.getByRole('link', { name: 'High Flyer' })
    screen.getByText('300.0')
  })

  it('renders the missing-value placeholder for a distance of 0 and real values for the rest; hours keep 0.0', () => {
    const stats: ResolvedClubStats[] = [
      { name: 'No Distance', flights: 3, distanceKm: 0, hours: 0, userId: 1 },
      { name: 'Short', flights: 2, distanceKm: 0.4, hours: 1, userId: 2 },
      { name: 'Long', flights: 1, distanceKm: 300, hours: 1, userId: 3 },
    ]
    render(<StatsLeaderboard stats={stats} isSignedIn followedPilotIds={[]} />)

    const cells = (name: string) =>
      [...(screen.getByText(name).closest('tr')?.querySelectorAll('td') ?? [])].map((td) => td.textContent)
    expect(cells('No Distance').slice(0, 4)).toEqual(['No Distance', '3', MISSING_VALUE, '0.0'])
    expect(cells('Short')[2]).toBe('0.4')
    expect(cells('Long')[2]).toBe('300.0')
  })

  it('still sorts a 0-distance row as numeric 0 by distance', () => {
    const stats: ResolvedClubStats[] = [
      { name: 'No Distance', flights: 9, distanceKm: 0, hours: 1, userId: 1 },
      { name: 'Short', flights: 2, distanceKm: 0.4, hours: 1, userId: 2 },
    ]
    render(<StatsLeaderboard stats={stats} isSignedIn followedPilotIds={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /distance/i }))

    expect(rowOrder().map((text) => text.slice(0, 5))).toEqual(['Short', 'No Di'])
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

  it('shows an arrow icon, not a text glyph, next to the actively sorted column', () => {
    const { container } = render(<StatsLeaderboard stats={ROWS} isSignedIn followedPilotIds={[]} />)

    expect(container.querySelector('th[aria-sort="descending"] svg')).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: /^flights/i }).textContent).not.toContain('↓')
  })

  it('labels each cell for the stacked layout and keeps the sort headers visible below sm:', () => {
    const { container } = render(<StatsLeaderboard stats={ROWS} isSignedIn followedPilotIds={[]} />)

    const firstRow = container.querySelector('tbody tr') as HTMLTableRowElement
    expect([...firstRow.querySelectorAll('td')].map((td) => td.getAttribute('data-label'))).toEqual(['Pilot', 'Flights', 'Distance (km)', 'Hours', 'Follow'])
    expect(container.querySelector('thead')?.className).not.toContain('sr-only')
    for (const th of container.querySelectorAll('th[aria-sort]')) expect(th.className).not.toContain('max-sm:hidden')
  })

  it('leaves the Follow cell empty, and hidden below sm:, for a pilot without a userId', () => {
    render(<StatsLeaderboard stats={ROWS} isSignedIn followedPilotIds={[]} />)

    const cell = screen.getByText('Ambiguous Name').closest('tr')?.querySelectorAll('td')[4] as HTMLTableCellElement
    expect(cell.childElementCount).toBe(0)
    expect(cell.className).toContain('max-sm:empty:hidden!')
  })
})
