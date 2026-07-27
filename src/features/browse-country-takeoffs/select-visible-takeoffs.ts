import { matchesFoldedQuery } from '@/lib/text-search/fold-search'
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'

export type RegionOption = { regionId: number; name: string }

// 'all' rather than a bare number sentinel like -1 or 0 — parse-regions.ts's own boundary
// check (readNonNegativeInteger) accepts 0 as a real regionId, so 0 is not free to reuse as
// "no filter" here without risking a real region silently becoming unselectable.
export type RegionFilter = number | 'all'

// 6012 rows (Norway's full fixture) rendered as DOM nodes on every keystroke, with no
// virtualisation available in this repo or its dependencies (confirmed: neither is in
// package.json, and nothing in node_modules provides one), is real per-keystroke jank, not a
// theoretical one. 200 is small enough to paint instantly and large enough that even a
// two- or three-character query, which can still match hundreds of rows, shows a genuinely
// useful working set rather than an arbitrary sliver of it.
export const MAX_RENDERED_RESULTS = 200

export type VisibleTakeoffs = {
  matches: TakeoffDirectoryEntry[]
  totalMatchCount: number
  isTruncated: boolean
}

// Pure — no DOM, no fetch, so the whole filter/cap/truncate pipeline is one thing to test
// without mounting a component. Filtering runs BEFORE capping, never the reverse: `matches`
// is always the first MAX_RENDERED_RESULTS entries of the REAL match set, not a slice of the
// full unfiltered list that then gets narrowed down to fewer than the cap by chance.
export function selectVisibleTakeoffs(
  takeoffs: TakeoffDirectoryEntry[],
  query: string,
  regionFilter: RegionFilter,
): VisibleTakeoffs {
  const matched = takeoffs.filter(
    (takeoff) =>
      (regionFilter === 'all' || takeoff.regionId === regionFilter) && matchesFoldedQuery(takeoff.name, query),
  )

  return {
    matches: matched.slice(0, MAX_RENDERED_RESULTS),
    totalMatchCount: matched.length,
    isTruncated: matched.length > MAX_RENDERED_RESULTS,
  }
}
