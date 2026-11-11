import { formatCalendarDate } from '@/lib/text/format-calendar-date'

// One fixed locale, not the viewer's: reading navigator.language made the server (and the
// hydration pass) render a different string than the browser, a visible flash of raw ISO text.
// A constant renders the identical string everywhere and keeps prerendered pages static.
const DATE_LOCALE = 'en-GB'

export function createCalendarDateFormatter(): (value: string) => string {
  return (value) => formatCalendarDate(value, DATE_LOCALE)
}
