import { totalFlightCount } from '@/lib/flightlog/flight-count'
import { formatFlightDistance, formatFlightDuration } from '@/lib/flightlog/format-flight'
import type { Flight } from '@/lib/flightlog/types'
import {
  breakdownByGlider,
  breakdownBySite,
  flyingDaysByDate,
  longestFlightByDistance,
  longestFlightByDuration,
  minutesByYear,
  totalDurationMinutes,
} from './statistics'

type PilotStatisticsProps = {
  flights: Flight[]
}

// #16's pilot statistics dashboard: pure derivations over the already-fetched logbook
// (see statistics.ts), rendered alongside PilotLogbook on the same /pilots/[userId] page —
// no new fetch, no charting dependency (recorded decisions on the issue). Everything here is
// a synchronous read of `flights`, so this stays a plain server component with no 'use client'.
export default function PilotStatistics({ flights }: PilotStatisticsProps) {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-medium">Statistics</h2>
      {flights.length === 0 ? (
        <EmptyStatistics />
      ) : (
        <>
          <TotalsSummary flights={flights} />
          <HoursByYear flights={flights} />
          <div className="grid gap-6 sm:grid-cols-2">
            <Breakdown title="By glider" totals={breakdownByGlider(flights)} />
            <Breakdown title="By site" totals={breakdownBySite(flights)} />
          </div>
          <LongestFlights flights={flights} />
          <FlyingDaysHeatmap flights={flights} />
        </>
      )}
    </section>
  )
}

// Pre-rounds to whole tenths of an hour BEFORE dividing back down to a decimal, rather than
// `(minutes / 60).toFixed(1)` — 51 minutes is 0.85h exactly in real numbers, but 0.85 has no
// exact IEEE754 double representation (it stores as ~0.84999999999999997...), so
// `(0.85).toFixed(1)` truncates to "0.8" instead of rounding to "0.9". Rounding to an integer
// (`tenthsOfHour`) first lands on a value `.toFixed(1)` can render correctly, sidestepping the
// binary-fraction boundary entirely instead of landing on it.
function formatMinutesAsHours(minutes: number): string {
  const tenthsOfHour = Math.round(minutes / 6)
  return `${(tenthsOfHour / 10).toFixed(1)} h`
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function TotalsSummary({ flights }: { flights: Flight[] }) {
  const flightCount = totalFlightCount(flights)
  const hours = formatMinutesAsHours(totalDurationMinutes(flights))
  const flyingDays = flyingDaysByDate(flights).size

  return (
    <p className="text-sm opacity-70">
      {pluralize(flightCount, 'flight')} · {hours} · {pluralize(flyingDays, 'flying day')}
    </p>
  )
}

function HoursByYear({ flights }: { flights: Flight[] }) {
  const entries = [...minutesByYear(flights).entries()].sort(([yearA], [yearB]) => yearB - yearA)

  if (entries.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium opacity-70">Hours by year</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left dark:border-white/15">
              <th className="py-2 pr-4 font-medium">Year</th>
              <th className="py-2 font-medium text-right">Hours</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([year, minutes]) => (
              <tr key={year} className="border-b border-black/5 last:border-0 dark:border-white/10">
                <td className="py-1 pr-4">{year}</td>
                <td className="py-1 text-right tabular-nums">{formatMinutesAsHours(minutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Descending by count so the largest share leads — ties keep the Map's own insertion order
// (the flights array's own order), which is stable given a fixed input rather than
// meaningful on its own.
//
// REVERT GUARD: index.test.tsx pins this direction (and the bar-width and heat-level
// computations below) with a dedicated test each — a revert to ascending order passes every
// OTHER test in this file, since none of them depend on which end of the list leads.
function sortedByCountDescending(totals: Map<string, number>): [string, number][] {
  return [...totals.entries()].sort((a, b) => b[1] - a[1])
}

// A CSS-width bar, not a chart library — recorded decision on #16 (no charting dependency
// added). Shared by both "By glider" and "By site"; only the title and the totals differ.
function Breakdown({ title, totals }: { title: string; totals: Map<string, number> }) {
  const entries = sortedByCountDescending(totals)
  const max = entries[0]?.[1] ?? 0

  if (entries.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium opacity-70">{title}</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {entries.map(([label, count]) => (
          <li key={label} className="flex items-center gap-2">
            <span className="w-32 shrink-0 truncate">{label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-black/5 dark:bg-white/10">
              <span
                className="block h-full rounded bg-black/40 dark:bg-white/50"
                style={{ width: `${(count / max) * 100}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right tabular-nums opacity-70">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LongestFlights({ flights }: { flights: Flight[] }) {
  // #16's recorded decision: longest-by-duration only ever considers flightCount === 1 rows
  // (see statistics.ts's longestFlightByDuration doc comment) — an aggregated row's duration
  // is a group total, not one flight's. The "single-flight rows only" qualifier below says so
  // in the card itself, not just in a comment a reader of the rendered page never sees.
  // Longest-by-distance has no such restriction.
  const byDuration = longestFlightByDuration(flights)
  const byDistance = longestFlightByDistance(flights)

  if (byDuration === null && byDistance === null) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium opacity-70">Longest flights</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {byDuration && (
          <li>
            By duration (single-flight rows only): {formatFlightDuration(byDuration)} ({byDuration.date}
            {byDuration.takeoff && ` at ${byDuration.takeoff}`})
          </li>
        )}
        {byDistance && (
          <li>
            By distance: {formatFlightDistance(byDistance)} ({byDistance.date}
            {byDistance.takeoff && ` at ${byDistance.takeoff}`})
          </li>
        )}
      </ul>
    </div>
  )
}

// A GitHub-contributions-style tinted calendar, not a real month/week layout — per-year rows
// of day cells, chronological within a year, shaded by that day's own flight count relative to
// the busiest day in this logbook. CSS grid of divs, per #16's no-charting-dependency decision.
//
// Level 0 is reserved for a day with NO flights — the calendar below renders one of these for
// every absent day in a covered year, not just the days a row exists for, so a long gap between
// flying days reads as a visible stretch of level-0 cells rather than two heat cells sitting
// next to each other with years unaccounted for in between.
const HEAT_LEVEL_CLASSES = [
  'bg-black/5 dark:bg-white/5',
  'bg-black/20 dark:bg-white/25',
  'bg-black/35 dark:bg-white/40',
  'bg-black/50 dark:bg-white/55',
  'bg-black/70 dark:bg-white/70',
]

// Levels 1..(HEAT_LEVEL_CLASSES.length - 1) scale a PRESENT day's intensity; level 0 is absent
// only, never assigned to a day that has flights. Two bugs in the old version this replaces:
// level 0 was unreachable whenever `max > 1` (nothing ever mapped to it, so it was dead code),
// and `max <= 1` (a pilot who never flew twice in one day) forced EVERY present day to the
// darkest level, the opposite of "scales with intensity" — a single-flight day looked exactly
// as busy as the pilot's busiest possible day. Scaling from 1, not 0, means a `max <= 1`
// logbook renders its one busy-ness level as the LIGHTEST present shade, not the darkest, and
// a `max > 1` logbook spreads count 1..max across the full lightest..darkest present range —
// REVERT GUARD, see sortedByCountDescending's own comment above.
function heatLevel(count: number, max: number): number {
  if (count === 0) return 0
  const presentLevels = HEAT_LEVEL_CLASSES.length - 1
  if (max <= 1) return 1
  const ratio = (count - 1) / (max - 1)
  return 1 + Math.round(ratio * (presentLevels - 1))
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Every calendar day in `year`, Jan 1 through Dec 31 — clipped to `today` for the current year
// so the heatmap never renders a not-yet-happened day as an absent (level 0) flying day, which
// would misread as a gap rather than as "the future." UTC throughout: `today` and every
// generated date are compared and stepped as UTC midnights so the loop can't skip or repeat a
// day around a local-timezone DST boundary.
function datesInYear(year: number, today: Date): string[] {
  const start = Date.UTC(year, 0, 1)
  const end = Math.min(
    Date.UTC(year, 11, 31),
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  )

  const dates: string[] = []
  for (let day = start; day <= end; day += 24 * 60 * 60 * 1000) {
    dates.push(toIsoDate(new Date(day)))
  }
  return dates
}

// Years with at least one flying day, present-year-first — the full descending range this
// calendar covers, INCLUDING years with zero flying days in between (a pilot who flew in 2016
// and 2014 but not 2015 still gets a 2015 row, per yearsInRange below; this set only says which
// of those years get a real calendar grid vs a one-line gap marker).
function yearsWithFlyingDays(dates: Iterable<string>): Set<number> {
  return new Set([...dates].map((date) => Number(date.slice(0, 4))))
}

// The full descending year range a calendar must account for — every year from the earliest to
// the latest flying day, not just the years that themselves have one. Without this, a calendar
// covering 2014 and 2016 but not 2015 would jump straight from one row to the other with no
// visible sign that 2015 was ever skipped, rather than fallow.
function yearsInRange(years: Iterable<number>): number[] {
  const values = [...years]
  if (values.length === 0) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  return Array.from({ length: max - min + 1 }, (_, index) => max - index)
}

// One row's own accessible summary, read once instead of once per cell — the day cells
// themselves are aria-hidden (see CalendarYearRow), so this is the only thing a screen reader
// announces for the whole year.
function summarizeCalendarYear(
  dates: string[],
  flightsByDate: Map<string, number>,
): { flyingDays: number; flights: number } {
  let flyingDays = 0
  let flights = 0
  for (const date of dates) {
    const count = flightsByDate.get(date) ?? 0
    if (count > 0) {
      flyingDays += 1
      flights += count
    }
  }
  return { flyingDays, flights }
}

function FlyingDaysHeatmap({ flights }: { flights: Flight[] }) {
  const flightsByDate = flyingDaysByDate(flights)

  if (flightsByDate.size === 0) return null

  const max = [...flightsByDate.values()].reduce((highest, count) => Math.max(highest, count), 0)
  const today = new Date()
  const yearsWithData = yearsWithFlyingDays(flightsByDate.keys())

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium opacity-70">Flying days ({flightsByDate.size})</h3>
      {yearsInRange(yearsWithData).map((year) =>
        yearsWithData.has(year) ? (
          <CalendarYearRow key={year} year={year} flightsByDate={flightsByDate} max={max} today={today} />
        ) : (
          <GapYearRow key={year} year={year} />
        ),
      )}
    </div>
  )
}

// A fully fallow year between two flying years — a single muted line, not a 365-cell grid of
// level-0 "no flights" cells (that would just move finding A's cell-count problem here).
function GapYearRow({ year }: { year: number }) {
  return <p className="text-xs tabular-nums opacity-60">{year}: no flights</p>
}

function CalendarYearRow({
  year,
  flightsByDate,
  max,
  today,
}: {
  year: number
  flightsByDate: Map<string, number>
  max: number
  today: Date
}) {
  const dates = datesInYear(year, today)
  const { flyingDays, flights } = summarizeCalendarYear(dates, flightsByDate)
  const label = `${year}: ${pluralize(flyingDays, 'flying day')}, ${pluralize(flights, 'flight')}`

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs tabular-nums opacity-60">{year}</span>
      <div
        role="img"
        aria-label={label}
        className="grid grid-cols-[repeat(auto-fill,minmax(0.65rem,1fr))] gap-1"
      >
        {dates.map((date) => (
          <HeatmapDayCell key={date} date={date} count={flightsByDate.get(date) ?? 0} max={max} />
        ))}
      </div>
    </div>
  )
}

// Individual cells carry no accessible name of their own (aria-hidden) — CalendarYearRow's own
// role="img"/aria-label above is the one thing a screen reader announces for the whole year,
// which is what keeps a 134-row, multi-decade logbook from generating one "no flights"
// announcement per absent day. An absent day (count === 0) gets no title either, so it renders
// as nothing but a styled div; a present day keeps its title as a sighted-user tooltip.
function HeatmapDayCell({ date, count, max }: { date: string; count: number; max: number }) {
  const title = count === 0 ? undefined : `${date}: ${pluralize(count, 'flight')}`

  return (
    <div
      aria-hidden="true"
      title={title}
      className={`h-3 w-3 rounded-sm ${HEAT_LEVEL_CLASSES[heatLevel(count, max)]}`}
    />
  )
}

function EmptyStatistics() {
  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      No flights recorded yet: statistics will appear once this pilot has logged flights.
    </p>
  )
}
