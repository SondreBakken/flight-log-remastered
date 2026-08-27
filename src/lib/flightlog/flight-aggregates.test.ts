import { describe, expect, it } from 'vitest'
import type { Flight } from './types'
import { breakdownBySite, flyingDaysByDate, parseDurationMinutes, totalDurationMinutes } from './flight-aggregates'

let nextTripId = 1
function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    tripId: nextTripId++,
    userId: 12677,
    date: '2026-07-23',
    country: 'Norway',
    takeoff: 'Voss, Hjelle/Gjelle',
    takeoffRef: null,
    glider: 'skywalk Mescal 6',
    duration: '00:10',
    flightCount: 1,
    distanceKm: null,
    openDistanceKm: null,
    note: null,
    ...overrides,
  }
}

describe('parseDurationMinutes', () => {
  it('parses H:MM', () => {
    expect(parseDurationMinutes('1:05')).toBe(65)
  })

  it('parses HH:MM', () => {
    expect(parseDurationMinutes('12:30')).toBe(750)
  })

  it('parses a bare-minutes row (00:MM)', () => {
    expect(parseDurationMinutes('00:45')).toBe(45)
  })
})

describe('totalDurationMinutes', () => {
  it('sums row durations, which are already group totals — never multiplied or divided by flightCount', () => {
    const flights = [
      flight({ duration: '00:10', flightCount: 1 }),
      // Aggregated row: '00:30' is the GROUP TOTAL across 6 flights (#68), so this must
      // contribute exactly 30 minutes, not 30/6 or 30*6.
      flight({ duration: '00:30', flightCount: 6 }),
    ]

    expect(totalDurationMinutes(flights)).toBe(40)
  })

  it('skips rows with no recorded duration', () => {
    const flights = [flight({ duration: null, flightCount: 3 }), flight({ duration: '00:20', flightCount: 1 })]

    expect(totalDurationMinutes(flights)).toBe(20)
  })

  // Decision pinned in flight-year.ts's isCalendarDate doc comment: a placeholder-dated row
  // (real fixture shape 'YYYY-00-00', pilot 4549's trips 987253/966728) is still a real
  // flight — only flying-day counting and the longest-flight cards exclude it, not the totals.
  it('still counts a placeholder-dated row (YYYY-00-00) toward the total, unlike flyingDaysByDate', () => {
    const flights = [flight({ date: '2026-00-00', duration: '00:20', flightCount: 1 })]

    expect(totalDurationMinutes(flights)).toBe(20)
  })
})

describe('breakdownBySite', () => {
  it('sums flightCount per takeoff site, not row count', () => {
    const flights = [
      flight({ takeoff: 'Voss, Hjelle/Gjelle', flightCount: 3 }),
      flight({ takeoff: 'Voss, Hjelle/Gjelle', flightCount: 1 }),
    ]

    expect(breakdownBySite(flights).get('Voss, Hjelle/Gjelle')).toBe(4)
  })

  it('labels a null takeoff as "Unknown takeoff" rather than dropping the row', () => {
    const flights = [flight({ takeoff: null, flightCount: 1 })]

    expect(breakdownBySite(flights).get('Unknown takeoff')).toBe(1)
  })
})

describe('flyingDaysByDate', () => {
  it('sums flightCount for two rows sharing one date into a single day', () => {
    const flights = [
      flight({ date: '2026-07-23', glider: 'Wing A', flightCount: 2 }),
      flight({ date: '2026-07-23', glider: 'Wing B', flightCount: 1 }),
    ]

    const result = flyingDaysByDate(flights)

    expect(result.size).toBe(1)
    expect(result.get('2026-07-23')).toBe(3)
  })

  it('keeps distinct dates as distinct flying days, .size giving the flying-day total', () => {
    const flights = [
      flight({ date: '2026-07-23', flightCount: 1 }),
      flight({ date: '2026-07-24', flightCount: 6 }),
    ]

    const result = flyingDaysByDate(flights)

    // Two flying days even though the second row alone is six flights — flying days and
    // flights are different numbers for exactly this reason.
    expect(result.size).toBe(2)
    expect(result.get('2026-07-24')).toBe(6)
  })

  // Real fixture shape (pilot-4549.html, trips 987253/966728): a placeholder date isn't a
  // real calendar day to plot, so it must not inflate the flying-day count — this is what
  // kept the "Flying days (129)" heading from matching 127 actually-shaded cells.
  it('excludes placeholder-dated rows (YYYY-00-00) from the flying-day count', () => {
    const flights = [
      flight({ date: '2026-00-00', flightCount: 1 }),
      flight({ date: '2026-07-23', flightCount: 1 }),
    ]

    const result = flyingDaysByDate(flights)

    expect(result.size).toBe(1)
    expect(result.has('2026-00-00')).toBe(false)
  })
})
