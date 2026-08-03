import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import PilotStatistics from './index'
import type { Flight } from '@/lib/flightlog/types'

let nextTripId = 1
function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    tripId: nextTripId++,
    userId: 12677,
    date: '2026-07-23',
    country: 'Norway',
    takeoff: 'Voss, Hjelle/Gjelle',
    glider: 'skywalk Mescal 6',
    duration: '00:10',
    flightCount: 1,
    distanceKm: null,
    openDistanceKm: null,
    note: null,
    ...overrides,
  }
}

describe('PilotStatistics', () => {
  it('renders the empty state and no summary line when the pilot has no flights', () => {
    render(<PilotStatistics flights={[]} />)

    screen.getByText(/statistics will appear once this pilot has logged flights/)
    expect(screen.queryByText(/flying days?$/)).toBeNull()
  })

  // #70/#68's shape, same as browse-pilot-logbook's own regression test: two single-flight
  // rows and two aggregated rows (flightCount 1, 2, 6, 1) totalling 10 flights, not 4 rows —
  // the dashboard's totals summary must report flights, not rows. Also pins two fixes
  // together: "1 flying day" (not "1 flying days"), and 51 minutes rendering as "0.9 h", not
  // the old "0.8 h" — (0.85).toFixed(1) truncates under IEEE754 (0.85 has no exact double
  // representation), so formatMinutesAsHours pre-rounds to whole tenths of an hour first.
  it('sums flightCount for the totals summary, not row count, on a mix of single and aggregated rows', () => {
    const flights: Flight[] = [
      flight({ duration: '00:05', flightCount: 1 }),
      flight({ duration: '00:10', flightCount: 2 }),
      flight({ duration: '00:30', flightCount: 6 }),
      flight({ duration: '00:06', flightCount: 1 }),
    ]

    render(<PilotStatistics flights={flights} />)

    // 5 + 10 + 30 + 6 = 51 minutes = 0.85h, correctly rounded to 0.9h.
    screen.getByText('10 flights · 0.9 h · 1 flying day')
  })

  it('counts two rows sharing one date as a single flying day, summing their flights', () => {
    const flights: Flight[] = [
      flight({ date: '2026-07-23', glider: 'Wing A', flightCount: 2 }),
      flight({ date: '2026-07-23', glider: 'Wing B', flightCount: 1 }),
      flight({ date: '2026-07-24', glider: 'Wing A', flightCount: 1 }),
    ]

    render(<PilotStatistics flights={flights} />)

    // 2 + 1 + 1 = 4 flights across three rows of 10 minutes each = 30 minutes = 0.5h.
    screen.getByText('4 flights · 0.5 h · 2 flying days')
  })

  it('renders hours-by-year, glider and site breakdowns as tables/lists, not a chart', () => {
    const flights: Flight[] = [
      flight({ date: '2024-06-01', glider: 'Mescal 6', takeoff: 'Voss, Hjelle' }),
      flight({ date: '2026-01-01', glider: 'Other Wing', takeoff: 'Voss, Hjelle' }),
    ]

    render(<PilotStatistics flights={flights} />)

    // Scoped to the "Hours by year" table specifically — the flying-days calendar below also
    // labels its own per-year rows "2024"/"2026", so an unscoped query would find two matches.
    const hoursByYearTable = screen.getByRole('table')
    within(hoursByYearTable).getByText('2024')
    within(hoursByYearTable).getByText('2026')
    screen.getByText('Mescal 6')
    screen.getByText('Other Wing')
    screen.getByText('Voss, Hjelle')
  })

  it('labels a null glider and null takeoff as unknown rather than omitting the row', () => {
    const flights: Flight[] = [flight({ glider: null, takeoff: null })]

    render(<PilotStatistics flights={flights} />)

    screen.getByText('Unknown glider')
    screen.getByText('Unknown takeoff')
  })

  // Real fixture shape (pilot-4549.html: "falcon 4" vs "Falcon 4"; pilot-12677.html: "skywalk
  // Mescal 6" vs "Skywalk Mescal 6") — statistics.test.ts pins the grouping logic itself in
  // detail, this only confirms the merged, most-frequent-spelling label is what actually
  // reaches the rendered breakdown.
  it('renders one glider-breakdown row for case/whitespace spelling variants, not one per spelling', () => {
    const flights: Flight[] = [
      flight({ glider: 'falcon 4', flightCount: 3 }),
      flight({ glider: 'Falcon 4', flightCount: 2 }),
    ]

    render(<PilotStatistics flights={flights} />)

    screen.getByText('falcon 4')
    expect(screen.queryByText('Falcon 4')).toBeNull()
  })

  it('shows the longest flight by duration only among single-flight rows, with a qualifier saying so, excluding an aggregated row', () => {
    const flights: Flight[] = [
      flight({ date: '2026-05-01', duration: '05:00', flightCount: 6, takeoff: 'Aggregated Site' }),
      flight({ date: '2026-05-02', duration: '00:45', flightCount: 1, takeoff: 'Single Site' }),
    ]

    render(<PilotStatistics flights={flights} />)

    screen.getByText(/By duration \(single-flight rows only\): 00:45 \(2026-05-02 at Single Site\)/)
  })

  it('shows the longest flight by distance using the openDistanceKm fallback', () => {
    const flights: Flight[] = [
      flight({ date: '2026-05-01', distanceKm: null, openDistanceKm: 40, takeoff: 'Open Site' }),
      flight({ date: '2026-05-02', distanceKm: 15, takeoff: 'Closed Site' }),
    ]

    render(<PilotStatistics flights={flights} />)

    screen.getByText(/By distance: 40\.0 km \(2026-05-01 at Open Site\)/)
  })

  it('renders the flying-days count in the heading', () => {
    const flights: Flight[] = [
      flight({ date: '2026-05-01' }),
      flight({ date: '2026-05-02' }),
      flight({ date: '2026-05-03' }),
    ]

    render(<PilotStatistics flights={flights} />)

    screen.getByText('Flying days (3)')
  })

  // #7's core complaint: the old heatmap rendered only present days, so two flying days a
  // year apart sat right next to each other with nothing showing the gap between them. This
  // pins that a genuinely absent day BETWEEN two flying days now renders its own cell.
  it('renders an absent-day cell (level 0, "no flights") for a gap between two flying days', () => {
    const flights: Flight[] = [flight({ date: '2026-05-01' }), flight({ date: '2026-05-03' })]

    render(<PilotStatistics flights={flights} />)

    const gapDay = screen.getByLabelText('2026-05-02: no flights')
    const flownDay = screen.getByLabelText('2026-05-01: 1 flight')
    expect(gapDay).not.toEqual(flownDay)
  })

  // Minimal accessibility per #7: every calendar cell carries an aria-label, not just a
  // `title` attribute (a title alone is not exposed to screen readers on a non-interactive
  // div the same way an accessible name is).
  it('gives every heatmap cell an accessible name in addition to its title', () => {
    const flights: Flight[] = [flight({ date: '2026-05-01', flightCount: 2 })]

    render(<PilotStatistics flights={flights} />)

    const cell = screen.getByLabelText('2026-05-01: 2 flights')
    expect(cell.getAttribute('title')).toBe('2026-05-01: 2 flights')
  })

  // REVERT GUARD (see index.tsx's own comment on sortedByCountDescending): pins descending
  // order specifically, so a revert to ascending (or to insertion order) fails this test even
  // though every other assertion in this file is order-agnostic.
  it('pins the breakdown sort direction as descending by count', () => {
    const flights: Flight[] = [
      flight({ glider: 'Rare Wing', flightCount: 1 }),
      flight({ glider: 'Common Wing', flightCount: 5 }),
      flight({ glider: 'Middling Wing', flightCount: 3 }),
    ]

    render(<PilotStatistics flights={flights} />)

    const labels = screen.getAllByText(/Wing$/).map((element) => element.textContent)
    expect(labels).toEqual(['Common Wing', 'Middling Wing', 'Rare Wing'])
  })

  // REVERT GUARD: pins the bar-width formula (`count / max * 100%`) at a value (50%) that a
  // plausible-but-wrong alternative (e.g. `count / total * 100%`) would not produce.
  it('pins the breakdown bar width as count / max, not count / total', () => {
    const flights: Flight[] = [
      flight({ glider: 'Busy Wing', flightCount: 10 }),
      flight({ glider: 'Half Wing', flightCount: 5 }),
    ]

    const { container } = render(<PilotStatistics flights={flights} />)

    const bars = container.querySelectorAll('.bg-black\\/40')
    const widths = [...bars].map((bar) => (bar as HTMLElement).style.width)
    expect(widths).toContain('100%')
    expect(widths).toContain('50%')
  })

  // REVERT GUARD: pins heatLevel's two fixed bugs at once — level 0 must be reachable (an
  // absent day) even though every flying day here has count 1, AND a max-of-1 logbook (no day
  // with more than one flight) must render its flying days at the LIGHTEST present level, not
  // the darkest (the old `max <= 1` branch forced the darkest level unconditionally).
  it('pins heat level mapping: a max-of-1 logbook renders flying days at the lightest present level, not the darkest', () => {
    const flights: Flight[] = [flight({ date: '2026-05-01', flightCount: 1 })]

    const { container } = render(<PilotStatistics flights={flights} />)

    const flownCell = screen.getByLabelText('2026-05-01: 1 flight')
    const absentCell = screen.getByLabelText('2026-05-02: no flights')
    const darkestCellCount = container.querySelectorAll('.bg-black\\/70').length

    expect(flownCell.className).toContain('bg-black/20')
    expect(absentCell.className).toContain('bg-black/5')
    expect(darkestCellCount).toBe(0)
  })

  // REVERT GUARD, continued: with a real spread of counts, the busiest day reaches the
  // darkest present level and a one-flight day stays visibly lighter than a three-flight day —
  // pinning both ends and the middle of the scale at once.
  it('pins heat level mapping: intensity scales between the lightest and darkest present levels', () => {
    const flights: Flight[] = [
      flight({ date: '2026-05-01', flightCount: 1 }),
      flight({ date: '2026-05-02', flightCount: 3 }),
    ]

    render(<PilotStatistics flights={flights} />)

    const lightDay = screen.getByLabelText('2026-05-01: 1 flight')
    const busyDay = screen.getByLabelText('2026-05-02: 3 flights')

    expect(lightDay.className).toContain('bg-black/20')
    expect(busyDay.className).toContain('bg-black/70')
  })
})
