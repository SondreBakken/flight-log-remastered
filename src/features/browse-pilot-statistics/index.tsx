import { totalFlightCount } from '@/lib/flightlog/flight-count'
import { formatFlightDistance, formatFlightDuration } from '@/lib/flightlog/format-flight'
import type { Flight } from '@/lib/flightlog/types'
import { FlyingDaysCalendar } from './flying-days-calendar'
import {
  breakdownByGlider,
  breakdownBySite,
  flyingDaysByDate,
  longestFlightByDistance,
  longestFlightByDuration,
  minutesByYear,
  pluralize,
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
// The per-year grids and their expand/collapse state live in FlyingDaysCalendar, a client
// component (#81: an 18-year logbook otherwise streams ~6060 day-cell divs on every view). This
// stays a server component: it only computes the two serializable inputs that component needs —
// the compact date→count map, and "today" as a plain string so both sides agree on it without
// either calling `new Date()` (see datesInYear's own comment for why that matters).
function FlyingDaysHeatmap({ flights }: { flights: Flight[] }) {
  const flightsByDate = flyingDaysByDate(flights)

  if (flightsByDate.size === 0) return null

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium opacity-70">Flying days ({flightsByDate.size})</h3>
      <FlyingDaysCalendar flightsByDate={flightsByDate} today={today} />
    </div>
  )
}

function EmptyStatistics() {
  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      No flights recorded yet: statistics will appear once this pilot has logged flights.
    </p>
  )
}
