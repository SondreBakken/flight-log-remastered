import { describe, expect, it } from 'vitest'
import type { Flight } from '@/lib/flightlog/types'
import {
  breakdownByGlider,
  breakdownBySite,
  flyingDaysByDate,
  hoursByYear,
  longestFlightByDistance,
  longestFlightByDuration,
  parseDurationMinutes,
  totalDurationMinutes,
  totalFlightCount,
} from './statistics'

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
})

describe('hoursByYear', () => {
  it('groups total minutes by the date prefix year, across multiple years', () => {
    const flights = [
      flight({ date: '2024-06-01', duration: '01:00', flightCount: 1 }),
      flight({ date: '2024-07-01', duration: '00:30', flightCount: 1 }),
      flight({ date: '2026-01-15', duration: '02:00', flightCount: 1 }),
    ]

    const result = hoursByYear(flights)

    expect(result.get(2024)).toBe(90)
    expect(result.get(2026)).toBe(120)
    expect(result.size).toBe(2)
  })

  it('excludes rows with no recorded duration from the year total', () => {
    const flights = [flight({ date: '2026-01-01', duration: null, flightCount: 4 })]

    expect(hoursByYear(flights).has(2026)).toBe(false)
  })
})

describe('breakdownByGlider', () => {
  it('sums flightCount per glider, not row count', () => {
    const flights = [
      flight({ glider: 'Mescal 6', flightCount: 2 }),
      flight({ glider: 'Mescal 6', flightCount: 1 }),
      flight({ glider: 'Other Wing', flightCount: 5 }),
    ]

    const result = breakdownByGlider(flights)

    expect(result.get('Mescal 6')).toBe(3)
    expect(result.get('Other Wing')).toBe(5)
  })

  // Decision: a null glider is labelled "Unknown glider", not filtered out, so this
  // breakdown's total stays reconcilable against totalFlightCount instead of silently
  // undercounting.
  it('labels a null glider as "Unknown glider" rather than dropping the row', () => {
    const flights = [flight({ glider: null, flightCount: 2 })]

    const result = breakdownByGlider(flights)

    expect(result.get('Unknown glider')).toBe(2)
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

describe('longestFlightByDuration', () => {
  it('picks the row with the greatest parsed duration among single-flight rows', () => {
    const short = flight({ tripId: 1, duration: '00:20', flightCount: 1 })
    const long = flight({ tripId: 2, duration: '01:15', flightCount: 1 })

    expect(longestFlightByDuration([short, long])).toBe(long)
  })

  // The recorded decision on #16: an aggregated row's duration is a GROUP TOTAL, not one
  // flight's duration, so it must never win here even when its total dwarfs every single
  // row's — treating it as a single flight would fabricate a record the source never
  // published.
  it('excludes aggregated rows (flightCount > 1) even when their total duration is largest', () => {
    const aggregated = flight({ tripId: 1, duration: '05:00', flightCount: 6 })
    const single = flight({ tripId: 2, duration: '00:20', flightCount: 1 })

    expect(longestFlightByDuration([aggregated, single])).toBe(single)
  })

  it('returns null when no single-flight row has a recorded duration', () => {
    const flights = [
      flight({ duration: null, flightCount: 1 }),
      flight({ duration: '01:00', flightCount: 6 }),
    ]

    expect(longestFlightByDuration(flights)).toBeNull()
  })

  it('returns null for an empty logbook', () => {
    expect(longestFlightByDuration([])).toBeNull()
  })
})

describe('longestFlightByDistance', () => {
  it('picks the row with the greatest distanceKm', () => {
    const shorter = flight({ tripId: 1, distanceKm: 10 })
    const longer = flight({ tripId: 2, distanceKm: 50 })

    expect(longestFlightByDistance([shorter, longer])).toBe(longer)
  })

  // distanceKm ?? openDistanceKm — the same fallback formatFlightDistance uses — so a row
  // with no closed-distance record can still win on its open distance.
  it('falls back to openDistanceKm when distanceKm is null', () => {
    const withOpenOnly = flight({ tripId: 1, distanceKm: null, openDistanceKm: 40 })
    const withClosed = flight({ tripId: 2, distanceKm: 15 })

    expect(longestFlightByDistance([withOpenOnly, withClosed])).toBe(withOpenOnly)
  })

  it('considers aggregated rows too — unlike longestFlightByDuration, distance is not a group total', () => {
    const aggregated = flight({ tripId: 1, distanceKm: 80, flightCount: 6 })
    const single = flight({ tripId: 2, distanceKm: 20, flightCount: 1 })

    expect(longestFlightByDistance([aggregated, single])).toBe(aggregated)
  })

  it('returns null when every row has neither distanceKm nor openDistanceKm', () => {
    const flights = [flight({ distanceKm: null, openDistanceKm: null })]

    expect(longestFlightByDistance(flights)).toBeNull()
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
})

describe('totalFlightCount (re-exported for this feature)', () => {
  it('sums flightCount across rows, matching the shared implementation', () => {
    const flights = [flight({ flightCount: 2 }), flight({ flightCount: 6 })]

    expect(totalFlightCount(flights)).toBe(8)
  })
})
