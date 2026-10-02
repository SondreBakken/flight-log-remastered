'use client'

import { useCalendarDateFormatter } from './use-calendar-date-formatter'

export { useCalendarDateFormatter } from './use-calendar-date-formatter'

export function CalendarDate({ value }: { value: string }) {
  const formatCalendarDate = useCalendarDateFormatter()
  return formatCalendarDate(value)
}
