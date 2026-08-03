import { describe, expect, it } from 'vitest'
import type { Flight } from './types'
import { flightYear, isCalendarDate } from './flight-year'

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

describe('flightYear', () => {
  it('reads the year as the first four characters of the date', () => {
    expect(flightYear(flight({ date: '2024-06-01' }))).toBe(2024)
  })

  // The year digits of a placeholder date are still real, even though the day isn't — this
  // must keep working the same for a placeholder date as for a real one.
  it('reads the year from a placeholder date (YYYY-00-00) the same as any other', () => {
    expect(flightYear(flight({ date: '2026-00-00' }))).toBe(2026)
  })
})

describe('isCalendarDate', () => {
  it('accepts a real YYYY-MM-DD date', () => {
    expect(isCalendarDate('2026-07-23')).toBe(true)
  })

  // Real fixture shape (pilot-4549.html, trips 987253 and 966728): flightlog.org emits this
  // exact placeholder when a flight's day and month went unrecorded.
  it('rejects flightlog.org\'s real placeholder shape (YYYY-00-00)', () => {
    expect(isCalendarDate('2026-00-00')).toBe(false)
  })

  it('rejects a date with only the day unrecorded (YYYY-MM-00)', () => {
    expect(isCalendarDate('2026-07-00')).toBe(false)
  })

  it('rejects a date with only the month unrecorded (YYYY-00-DD)', () => {
    expect(isCalendarDate('2026-00-23')).toBe(false)
  })
})
