import { foldForSearch } from '@/lib/text-search/fold-search'
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
//
// This caps what gets RENDERED as DOM nodes — it does nothing for the cost of computing
// `matches` in the first place, which still scans and folds every row in `takeoffs`
// regardless of the cap. See foldTakeoffNames below for the fix to that half of the problem.
export const MAX_RENDERED_RESULTS = 200

// Pure — folds every name once, keyed by takeoffId. Exists so a caller can memoise this
// separately from the query: `takeoffs` is stable for the component's whole lifetime (one
// fetch, never refetched), but `query` changes on every keystroke, and folding is the
// expensive half of a search (measured: ~8.3ms over 6012 real names, most of a keystroke's
// ~11ms total). Keying selectVisibleTakeoffs's own memoisation on `[takeoffs, query,
// regionFilter]` as one unit — the shape this file had before — recomputes this fold on every
// keystroke even though `takeoffs` never changed; keying THIS separately on `takeoffs` alone
// (see index.tsx) is what lets it run exactly once per fetched dataset instead of once per
// keystroke.
//
// The React Compiler (enabled repo-wide, see next.config.ts) does not make this split
// unnecessary: it auto-memoises at the granularity the source is already written in — a
// single call `selectVisibleTakeoffs(takeoffs, query, regionFilter)` is one opaque unit to
// it, invalidated whenever any of the three arguments changes, `query` included, same as a
// hand-written `useMemo` keyed on all three would be. It cannot reach inside that call and
// discover that only part of the work depends on `takeoffs` alone. Splitting the fold into
// its own function, called separately from the filter, is what gives the compiler (or a
// manual useMemo, which index.tsx also uses, matching this file's existing convention) two
// independent units to memoise instead of one combined one.
export function foldTakeoffNames(takeoffs: TakeoffDirectoryEntry[]): Map<number, string> {
  return new Map(takeoffs.map((takeoff) => [takeoff.takeoffId, foldForSearch(takeoff.name)]))
}

// flightlog.org's own regionId 0 convention: not a real region (Norway's 29-row region list
// never contains id 0), but the value a takeoff carries when the site itself never assigned
// it one — 623 of Norway's 6012 takeoffs (10.4%) are like this. Displaying the bare id as
// `Region 0` claims a region exists under that number when none does; treated generically
// here as "any regionId absent from the fetched region list", not hardcoded to 0, since
// nothing about that value is guaranteed stable across countries.
export const UNREGIONED_LABEL = 'Unregioned'

// Pure — lets the dropdown offer an honest, selectable entry for takeoffs whose regionId has
// no matching region, instead of silently making them reachable only through "All regions."
// One synthetic option per distinct orphan regionId actually present in the data (not just a
// single hardcoded "0" entry) — filtering already works correctly for any of them, since
// selectVisibleTakeoffs compares raw regionId values.
export function withUnregionedOptions(regions: RegionOption[], takeoffs: TakeoffDirectoryEntry[]): RegionOption[] {
  const knownRegionIds = new Set(regions.map((region) => region.regionId))
  const orphanRegionIds = new Set(
    takeoffs.map((takeoff) => takeoff.regionId).filter((regionId) => !knownRegionIds.has(regionId)),
  )
  const unregionedOptions = [...orphanRegionIds].map((regionId) => ({ regionId, name: UNREGIONED_LABEL }))
  return [...regions, ...unregionedOptions]
}

// Pure — the dropdown's own alphabetisation, extracted so it's testable without mounting the
// component or reimplementing the sort in the assertion that checks it.
export function sortRegionOptions(regions: RegionOption[]): RegionOption[] {
  return [...regions].sort((a, b) => a.name.localeCompare(b.name))
}

export type VisibleTakeoffs = {
  matches: TakeoffDirectoryEntry[]
  totalMatchCount: number
  isTruncated: boolean
}

// Pure — no DOM, no fetch, so the whole filter/sort/cap/truncate pipeline is one thing to
// test without mounting a component. `foldedNames` is `foldTakeoffNames(takeoffs)`, supplied
// by the caller rather than computed here, so a caller that memoises it separately from
// `query` (see index.tsx) never pays the fold cost per keystroke — this function itself only
// folds the QUERY once per call, not once per row.
//
// The pipeline order matters and each step is deliberate:
// 1. Filter runs BEFORE capping, never the reverse: `matches` is always the first
//    MAX_RENDERED_RESULTS entries of the REAL match set, not a slice of the full unfiltered
//    list that then gets narrowed down to fewer than the cap by chance.
// 2. Sort runs BEFORE capping too, and is alphabetical by name — which 200 of a match set
//    over the cap get shown is a user-visible decision, not an accident of whatever order
//    `takeoffs` happened to arrive in from the fetch.
export function selectVisibleTakeoffs(
  takeoffs: TakeoffDirectoryEntry[],
  foldedNames: ReadonlyMap<number, string>,
  query: string,
  regionFilter: RegionFilter,
): VisibleTakeoffs {
  const foldedQuery = foldForSearch(query)
  const matched = takeoffs
    .filter(
      (takeoff) =>
        (regionFilter === 'all' || takeoff.regionId === regionFilter) &&
        (foldedNames.get(takeoff.takeoffId) ?? '').includes(foldedQuery),
    )
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    matches: matched.slice(0, MAX_RENDERED_RESULTS),
    totalMatchCount: matched.length,
    isTruncated: matched.length > MAX_RENDERED_RESULTS,
  }
}
