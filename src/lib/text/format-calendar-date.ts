const LEADING_ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(.*)$/

// Formats the leading `YYYY-MM-DD` of `value` for `locale`, keeping any trailing text (a time,
// an author) untouched. Values without a real calendar date at the start come back unchanged.
export function formatCalendarDate(value: string, locale: string): string {
  const match = LEADING_ISO_DATE.exec(value)
  if (!match) return value
  const [, year, month, day, rest] = match
  const date = toUtcCalendarDate(Number(year), Number(month), Number(day))
  if (!date) return value
  return `${formatUtcDate(date, locale)}${rest}`
}

// Built and formatted in UTC so the viewer's own timezone can never move the calendar day.
function toUtcCalendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  const isRealDay =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return isRealDay ? date : null
}

function formatUtcDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}
