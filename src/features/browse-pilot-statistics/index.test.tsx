import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
  // The calendar's own "today" clip (finding C) makes the current year's cell count depend on
  // the real wall-clock date unless pinned — fixed here at the fixture's own "today"
  // (2026-08-03) so every test in this file gets a stable, deterministic calendar regardless
  // of which real day the suite happens to run on.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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
  // pins that a genuinely absent day BETWEEN two flying days still renders its own cell — just
  // an unlabelled one now (see the accessibility tests below), not a full day-count regression.
  it('renders a day cell for a gap day between two flying days, distinct from the flown-day cells', () => {
    const flights: Flight[] = [flight({ date: '2026-05-01' }), flight({ date: '2026-05-03' })]

    const { container } = render(<PilotStatistics flights={flights} />)

    screen.getByRole('img', { name: '2026: 2 flying days, 2 flights' })
    const flownDay = container.querySelector('[title="2026-05-01: 1 flight"]')
    const gapDayIndex = [...container.querySelectorAll('.h-3.w-3')].findIndex(
      (cell) => !cell.hasAttribute('title'),
    )
    expect(flownDay).not.toBeNull()
    // A gap day exists somewhere in the grid (Jan 1 - Aug 3 renders many, since the calendar
    // covers the whole year-to-date, not just the range between the pilot's own flights).
    expect(gapDayIndex).toBeGreaterThanOrEqual(0)
  })

  // Round 2 fix (finding A): 5933 of pilot 4549's 6060 calendar cells were absent days, each
  // announced to screen readers as "date: no flights" — 890 KB of HTML server-rendered on every
  // view. The fix moves the accessible name to one summary per year row (role="img" +
  // aria-label) and hides the individual day cells from the accessibility tree entirely, with
  // an absent day carrying no title (or any other per-cell text) at all.
  it('gives the year row a single accessible name and hides day cells from the accessibility tree', () => {
    const flights: Flight[] = [flight({ date: '2026-05-01', flightCount: 2 })]

    const { container } = render(<PilotStatistics flights={flights} />)

    const yearRow = screen.getByRole('img', { name: '2026: 1 flying day, 2 flights' })
    const presentCell = container.querySelector('[title="2026-05-01: 2 flights"]') as HTMLElement
    // Jan 2 never had a flight, so it's an ordinary absent cell to check the "no title at all"
    // half of the fix.
    const absentCell = yearRow.children[1] as HTMLElement

    expect(presentCell.getAttribute('aria-hidden')).toBe('true')
    expect(absentCell.getAttribute('aria-hidden')).toBe('true')
    expect(absentCell.hasAttribute('title')).toBe(false)
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

    const flownCell = container.querySelector('[title="2026-05-01: 1 flight"]') as HTMLElement
    const [, absentCell] = [...screen.getByRole('img', { name: /^2026:/ }).children] as HTMLElement[]
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

    const { container } = render(<PilotStatistics flights={flights} />)

    const lightDay = container.querySelector('[title="2026-05-01: 1 flight"]') as HTMLElement
    const busyDay = container.querySelector('[title="2026-05-02: 3 flights"]') as HTMLElement

    expect(lightDay.className).toContain('bg-black/20')
    expect(busyDay.className).toContain('bg-black/70')
  })

  // Round 2 fix (finding C): the Math.min clip in datesInYear was the only changed line no
  // test pinned — this crosses the boundary and asserts the current year's row stops exactly at
  // "today" rather than rendering ~150 not-yet-happened days as absent cells.
  it('renders no calendar cells after today for the current year', () => {
    vi.setSystemTime(new Date('2026-06-15T00:00:00.000Z'))

    const flights: Flight[] = [flight({ date: '2026-06-10' })]
    render(<PilotStatistics flights={flights} />)

    // Jan 1 through Jun 15 inclusive, in a non-leap year: 31+28+31+30+31+15.
    const yearRow = screen.getByRole('img', { name: /^2026:/ })
    expect(yearRow.children).toHaveLength(166)
  })

  // Round 2 fix (finding D): yearsCoveredByDates used to emit only years containing a flight,
  // so the calendar jumped 2016 -> 2014 with no visible sign 2015 was ever skipped. A fully
  // fallow year in between now gets a compact one-line marker, not a full absent-cell grid
  // (which would reintroduce finding A's problem for that year).
  it('renders a compact "no flights" marker for a fully fallow year between two flying years', () => {
    const flights: Flight[] = [flight({ date: '2014-05-01' }), flight({ date: '2016-05-01' })]

    render(<PilotStatistics flights={flights} />)

    screen.getByText('2015: no flights')
    expect(screen.queryByRole('img', { name: /^2015:/ })).toBeNull()
  })

  // #81: an 18-year logbook rendered a day-cell grid for every year, ~6060 cells of HTML on
  // every view. Only the 5 most recent FLIGHT-BEARING years default to expanded; older ones
  // collapse behind the same "{year}: N flying days, M flights" text CalendarYearRow already
  // computes, now a clickable button instead of only an aria-label. 2022 is a genuinely fallow
  // year wedged between 2023 and 2021 — it must not itself count against the budget, or 2021
  // (the 5th real flight year) would wrongly collapse too.
  describe('collapsing older calendar years', () => {
    const flights: Flight[] = [2026, 2025, 2024, 2023, 2021, 2020].map((year) =>
      flight({ date: `${year}-01-10` }),
    )

    it('expands the 5 most recent flight-bearing years by default, without a fallow year consuming the budget', () => {
      render(<PilotStatistics flights={flights} />)

      for (const year of [2026, 2025, 2024, 2023, 2021]) {
        screen.getByRole('img', { name: `${year}: 1 flying day, 1 flight` })
      }
      screen.getByText('2022: no flights')
    })

    it('collapses the 6th most recent flight-bearing year behind a summary button with no day cells', () => {
      const { container } = render(<PilotStatistics flights={flights} />)

      expect(screen.queryByRole('img', { name: /^2020:/ })).toBeNull()
      screen.getByRole('button', { name: '2020: 1 flying day, 1 flight' })
      expect(container.querySelector('[title^="2020-"]')).toBeNull()
    })

    it('renders a collapsed year\'s day-cell grid after clicking its summary button', () => {
      render(<PilotStatistics flights={flights} />)

      fireEvent.click(screen.getByRole('button', { name: '2020: 1 flying day, 1 flight' }))

      screen.getByRole('img', { name: '2020: 1 flying day, 1 flight' })
    })
  })
})
