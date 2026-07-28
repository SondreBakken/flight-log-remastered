'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FollowButton } from '@/components/follow-button'
import {
  sortResolvedStats,
  type ClubStatsSortKey,
  type ResolvedClubStats,
  type SortDirection,
} from './resolve-stats-pilots'

type StatsLeaderboardProps = {
  stats: ResolvedClubStats[]
}

const COLUMNS: { key: ClubStatsSortKey; label: string }[] = [
  { key: 'flights', label: 'Flights' },
  { key: 'distanceKm', label: 'Distance (km)' },
  { key: 'hours', label: 'Hours' },
]

// Sorted highest-first on first click of a column, matching a leaderboard's own default
// reading order (most flights/distance/hours at the top) — flipping to ascending needs a
// second click, same toggle-on-reclick convention as every sortable table this repo would
// otherwise need to invent from scratch.
function nextSort(current: { key: ClubStatsSortKey; direction: SortDirection } | null, key: ClubStatsSortKey): {
  key: ClubStatsSortKey
  direction: SortDirection
} {
  if (current?.key !== key) return { key, direction: 'desc' }
  return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
}

export function StatsLeaderboard({ stats }: StatsLeaderboardProps) {
  const [sort, setSort] = useState<{ key: ClubStatsSortKey; direction: SortDirection } | null>(null)
  const rows = sort ? sortResolvedStats(stats, sort.key, sort.direction) : stats

  if (stats.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
        No pilot stats recorded for this club yet.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left dark:border-white/15">
            <th className="py-2 pr-4 font-medium">Pilot</th>
            {COLUMNS.map((column) => (
              <th key={column.key} className="py-2 pr-4 text-right font-medium">
                <button
                  type="button"
                  onClick={() => setSort((current) => nextSort(current, column.key))}
                  aria-pressed={sort?.key === column.key}
                  className="underline-offset-2 hover:underline"
                >
                  {column.label}
                  {sort?.key === column.key ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}
                </button>
              </th>
            ))}
            <th className="py-2 font-medium">Follow</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <StatsRow key={`${row.name}-${row.flights}-${row.distanceKm}-${row.hours}`} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// A stats row's own `userId` is `null` whenever its name resolved to zero or more than one
// roster member (see resolve-stats-pilots.ts) — that must render as "no link available", not
// as a name that merely looks like every other row. `userId === null` therefore renders the
// bare name, no Link and no FollowButton, rather than picking one of the ambiguous matches or
// omitting the row outright: the pilot's stats are still real and worth showing, only the
// identity behind them isn't known.
function StatsRow({ row }: { row: ResolvedClubStats }) {
  return (
    <tr className="border-b border-black/5 dark:border-white/10">
      <td className="py-2 pr-4">
        {row.userId === null ? (
          <span title="Multiple club members share this name — can't tell which one this is">{row.name}</span>
        ) : (
          <Link className="underline underline-offset-2" href={`/pilots/${row.userId}`}>
            {row.name}
          </Link>
        )}
      </td>
      <td className="py-2 pr-4 text-right">{row.flights}</td>
      <td className="py-2 pr-4 text-right">{row.distanceKm.toFixed(1)}</td>
      <td className="py-2 pr-4 text-right">{row.hours.toFixed(1)}</td>
      <td className="py-2">{row.userId !== null && <FollowButton pilotId={row.userId} variant="compact" />}</td>
    </tr>
  )
}
