import { describe, expect, it } from 'vitest'
import { formatCalendarDate } from './format-calendar-date'

describe('formatCalendarDate', () => {
  it('formats a bare ISO date with a short month for en-GB', () => {
    expect(formatCalendarDate('2026-09-05', 'en-GB')).toBe('5 Sept 2026')
  })

  it('formats a bare ISO date month-first for en-US', () => {
    expect(formatCalendarDate('2026-09-05', 'en-US')).toBe('Sep 5, 2026')
  })

  it('formats a bare ISO date for nb-NO', () => {
    expect(formatCalendarDate('2026-09-05', 'nb-NO')).toBe('5. sep. 2026')
  })

  it('never shifts the calendar day across timezones', () => {
    expect(formatCalendarDate('2026-01-01', 'en-GB')).toBe('1 Jan 2026')
    expect(formatCalendarDate('2026-12-31', 'en-GB')).toBe('31 Dec 2026')
  })

  it('keeps whatever follows the leading date (time, author) as-is', () => {
    expect(formatCalendarDate('2026-07-21 14:05', 'en-GB')).toBe('21 Jul 2026 14:05')
    expect(formatCalendarDate('2026-02-14 13:52:15 Martin Krossoy', 'en-GB')).toBe(
      '14 Feb 2026 13:52:15 Martin Krossoy',
    )
  })

  it('returns a value without a real calendar date unchanged', () => {
    expect(formatCalendarDate('2026-00-00', 'en-GB')).toBe('2026-00-00')
    expect(formatCalendarDate('2026-02-30', 'en-GB')).toBe('2026-02-30')
    expect(formatCalendarDate('yesterday', 'en-GB')).toBe('yesterday')
    expect(formatCalendarDate('', 'en-GB')).toBe('')
  })
})
