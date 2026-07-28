import type { ResolvedClubStats } from './resolve-stats-pilots'

// Split out of resolve-stats-pilots.ts (#7's fix round): that file's own name and doc comment
// are entirely about the roster/stats join, a business-logic concern, while sorting is a
// presentation concern consumed only by the client component (stats-leaderboard.tsx) —
// mixing the two in one file made a reader hunting for "how the join works" wade through
// unrelated sort code, and vice versa.
export type ClubStatsSortKey = 'flights' | 'distanceKm' | 'hours'
export type SortDirection = 'asc' | 'desc'

// A new array, never sorted in place — `stats` is a caller-owned prop/state value in every
// call site this file has (the leaderboard component's own state), and mutating a prop array
// in place is the kind of bug that only shows up as a confusing re-render later.
export function sortResolvedStats(stats: ResolvedClubStats[], key: ClubStatsSortKey, direction: SortDirection): ResolvedClubStats[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...stats].sort((a, b) => (a[key] - b[key]) * sign)
}
