'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FollowButton } from '@/components/follow-button'
import type { ResolvedClubStats } from './resolve-stats-pilots'
import { sortResolvedStats, type ClubStatsSortKey, type SortDirection } from './sort-resolved-stats'
import type { PilotId } from '@/lib/flightlog/types'

type StatsLeaderboardProps = {
  stats: ResolvedClubStats[]
  // Resolved once server-side by the page (see resolve-viewer-follow-state.ts) and passed down
  // as a plain array, since a 'use client' component can only receive serializable props from
  // its Server Component parent — converted to a Set once here (useMemo) for O(1) row lookups
  // rather than re-scanning the array per row.
  isSignedIn: boolean
  followedPilotIds: PilotId[]
}

const COLUMNS: { key: ClubStatsSortKey; label: string }[] = [
  { key: 'flights', label: 'Flights' },
  { key: 'distanceKm', label: 'Distance (km)' },
  { key: 'hours', label: 'Hours' },
]

// Sorted highest-first the first time a column becomes the sort key — either DEFAULT_SORT
// below (flights, on initial render) or the first click of a different column — matching a
// leaderboard's own default reading order (most flights/distance/hours at the top). Flipping
// to ascending needs a second click on the SAME column, same toggle-on-reclick convention as
// every sortable table this repo would otherwise need to invent from scratch.
function nextSort(current: { key: ClubStatsSortKey; direction: SortDirection }, key: ClubStatsSortKey): {
  key: ClubStatsSortKey
  direction: SortDirection
} {
  if (current.key !== key) return { key, direction: 'desc' }
  return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' }
}

// Flights descending, not unsorted — the table renders with a rank column implied by row
// order (highest first) before anyone clicks anything, so it must actually start ranked
// rather than looking ranked while secretly reflecting rqtid=1's own row order. This is also
// exactly what clicking the Flights header once would produce, so the default costs nothing
// extra to keep in sync.
const DEFAULT_SORT: { key: ClubStatsSortKey; direction: SortDirection } = { key: 'flights', direction: 'desc' }

export function StatsLeaderboard({ stats, isSignedIn, followedPilotIds }: StatsLeaderboardProps) {
  const [sort, setSort] = useState(DEFAULT_SORT)
  const rows = sortResolvedStats(stats, sort.key, sort.direction)
  const followedPilotIdSet = useMemo(() => new Set(followedPilotIds), [followedPilotIds])

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
              <th
                key={column.key}
                className="py-2 pr-4 text-right font-medium"
                aria-sort={sort.key === column.key ? (sort.direction === 'desc' ? 'descending' : 'ascending') : 'none'}
              >
                <button
                  type="button"
                  onClick={() => setSort((current) => nextSort(current, column.key))}
                  className="underline-offset-2 hover:underline"
                >
                  {column.label}
                  {sort.key === column.key ? (sort.direction === 'desc' ? ' ↓' : ' ↑') : ''}
                </button>
              </th>
            ))}
            <th className="py-2 font-medium">Follow</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <StatsRow
              key={row.userId ?? `${row.name}-${row.flights}-${row.distanceKm}-${row.hours}`}
              row={row}
              isFollowed={row.userId !== null && followedPilotIdSet.has(row.userId)}
              isSignedIn={isSignedIn}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// A stats row's own `userId` is `null` whenever its name resolved to zero OR more than one
// roster member (see resolve-stats-pilots.ts) — two different causes with one shared
// consequence, "no link available", not as a name that merely looks like every other row.
// `userId === null` therefore renders the bare name, no Link and no FollowButton, rather than
// picking one of the ambiguous matches or omitting the row outright: the pilot's stats are
// still real and worth showing, only the identity behind them isn't known. The wording below
// says "no profile link available" rather than committing to either cause, since `userId ===
// null` alone can't tell a genuine zero-match from an ambiguous multi-match apart. A `title`
// alone is also not enough signal — invisible on touch, never focusable, not announced by a
// screen reader — so the same explanation is repeated as visible text via `sr-only`.
function StatsRow({ row, isFollowed, isSignedIn }: { row: ResolvedClubStats; isFollowed: boolean; isSignedIn: boolean }) {
  return (
    <tr className="border-b border-black/5 dark:border-white/10">
      <td className="py-2 pr-4">
        {row.userId === null ? (
          <span title="No pilot profile link available for this name">
            <span>{row.name}</span>
            <span className="sr-only"> (no pilot profile link available for this name)</span>
          </span>
        ) : (
          <Link className="underline underline-offset-2" href={`/pilots/${row.userId}`}>
            {row.name}
          </Link>
        )}
      </td>
      <td className="py-2 pr-4 text-right">{row.flights}</td>
      <td className="py-2 pr-4 text-right">{row.distanceKm.toFixed(1)}</td>
      <td className="py-2 pr-4 text-right">{row.hours.toFixed(1)}</td>
      <td className="py-2">
        {row.userId !== null && (
          <FollowButton isFollowed={isFollowed} isSignedIn={isSignedIn} pilotId={row.userId} variant="compact" />
        )}
      </td>
    </tr>
  )
}
