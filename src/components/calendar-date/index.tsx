'use client'

import { createCalendarDateFormatter } from './create-calendar-date-formatter'

export { createCalendarDateFormatter } from './create-calendar-date-formatter'

export function CalendarDate({ value }: { value: string }) {
  const formatCalendarDate = createCalendarDateFormatter()
  return formatCalendarDate(value)
}
