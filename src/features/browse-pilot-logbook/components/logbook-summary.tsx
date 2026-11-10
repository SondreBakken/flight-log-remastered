import { breakdownByGlider } from '@/features/browse-pilot-statistics/statistics'
import { breakdownBySite, totalDistanceKm, totalDurationMinutes } from '@/lib/flightlog/flight-aggregates'
import { totalFlightCount } from '@/lib/flightlog/flight-count'
import { formatHours } from '@/lib/flightlog/format-flight'
import type { Flight } from '@/lib/flightlog/types'

const TOP_LIST_SIZE = 5

type LogbookSummaryProps = {
  flights: Flight[]
}

export function LogbookSummary({ flights }: LogbookSummaryProps) {
  return (
    <section aria-label="Summary" className="flex flex-col gap-4">
      <dl className="grid grid-cols-3 gap-4 text-sm">
        <Figure label="Flights" value={String(totalFlightCount(flights))} />
        <Figure label="Hours" value={formatHours(totalDurationMinutes(flights))} />
        <Figure label="Distance" value={`${totalDistanceKm(flights).toFixed(1)} km`} />
      </dl>
      <div className="grid gap-6 text-sm sm:grid-cols-2">
        <TopList title="Top takeoffs" totals={breakdownBySite(flights)} />
        <TopList title="Top gliders" totals={breakdownByGlider(flights)} />
      </div>
    </section>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="opacity-70">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
    </div>
  )
}

// Array.prototype.sort is stable, so equal counts keep the map's insertion order.
function topEntries(totals: Map<string, number>): [string, number][] {
  return [...totals.entries()].sort(([, a], [, b]) => b - a).slice(0, TOP_LIST_SIZE)
}

function TopList({ title, totals }: { title: string; totals: Map<string, number> }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-medium">{title}</h2>
      <ol className="flex flex-col gap-0.5">
        {topEntries(totals).map(([name, count]) => (
          <li key={name} className="flex justify-between gap-4">
            <span>{name}</span>
            <span className="tabular-nums opacity-70">{count}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
