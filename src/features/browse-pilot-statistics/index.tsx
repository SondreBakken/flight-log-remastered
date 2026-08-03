import { formatFlightDistance, formatFlightDuration } from '@/lib/flightlog/format-flight'
import type { Flight } from '@/lib/flightlog/types'
import {
  breakdownByGlider,
  breakdownBySite,
  flyingDaysByDate,
  hoursByYear,
  longestFlightByDistance,
  longestFlightByDuration,
  totalDurationMinutes,
  totalFlightCount,
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

function formatMinutesAsHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`
}

function TotalsSummary({ flights }: { flights: Flight[] }) {
  const flightCount = totalFlightCount(flights)
  const hours = formatMinutesAsHours(totalDurationMinutes(flights))
  const flyingDays = flyingDaysByDate(flights).size

  return (
    <p className="text-sm opacity-70">
      {flightCount} flights · {hours} · {flyingDays} flying days
    </p>
  )
}

function HoursByYear({ flights }: { flights: Flight[] }) {
  const minutesByYear = hoursByYear(flights)
  const years = [...minutesByYear.keys()].sort((a, b) => b - a)

  if (years.length === 0) return null

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
            {years.map((year) => (
              <tr key={year} className="border-b border-black/5 last:border-0 dark:border-white/10">
                <td className="py-1 pr-4">{year}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatMinutesAsHours(minutesByYear.get(year)!)}
                </td>
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
  // is a group total, not one flight's. Longest-by-distance has no such restriction.
  const byDuration = longestFlightByDuration(flights)
  const byDistance = longestFlightByDistance(flights)

  if (byDuration === null && byDistance === null) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium opacity-70">Longest flights</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {byDuration && (
          <li>
            By duration: {formatFlightDuration(byDuration)} — {byDuration.date}
            {byDuration.takeoff && ` at ${byDuration.takeoff}`}
          </li>
        )}
        {byDistance && (
          <li>
            By distance: {formatFlightDistance(byDistance)} — {byDistance.date}
            {byDistance.takeoff && ` at ${byDistance.takeoff}`}
          </li>
        )}
      </ul>
    </div>
  )
}

// A GitHub-contributions-style tinted grid, not a real month/week calendar layout — every
// present flying day, chronological, shaded by its own flight count relative to the busiest
// day in this logbook. CSS grid of divs, per #16's no-charting-dependency decision.
const HEAT_LEVEL_CLASSES = [
  'bg-black/10 dark:bg-white/15',
  'bg-black/25 dark:bg-white/30',
  'bg-black/40 dark:bg-white/45',
  'bg-black/55 dark:bg-white/60',
  'bg-black/75 dark:bg-white/75',
]

function heatLevel(count: number, max: number): number {
  if (max <= 1) return HEAT_LEVEL_CLASSES.length - 1
  const ratio = count / max
  return Math.min(HEAT_LEVEL_CLASSES.length - 1, Math.ceil(ratio * (HEAT_LEVEL_CLASSES.length - 1)))
}

function FlyingDaysHeatmap({ flights }: { flights: Flight[] }) {
  const flightsByDate = flyingDaysByDate(flights)
  const dates = [...flightsByDate.keys()].sort()
  const max = Math.max(...flightsByDate.values())

  if (dates.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium opacity-70">Flying days ({dates.length})</h3>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(0.75rem,1fr))] gap-1">
        {dates.map((date) => {
          const count = flightsByDate.get(date)!
          return (
            <div
              key={date}
              title={`${date}: ${count} flight${count === 1 ? '' : 's'}`}
              className={`h-3 w-3 rounded-sm ${HEAT_LEVEL_CLASSES[heatLevel(count, max)]}`}
            />
          )
        })}
      </div>
    </div>
  )
}

function EmptyStatistics() {
  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      No flights recorded yet — statistics will appear once this pilot has logged flights.
    </p>
  )
}
