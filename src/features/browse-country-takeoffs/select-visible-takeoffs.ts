import { foldForSearch } from '@/lib/text-search/fold-search'
import { haversineDistanceMetres, type GeoPoint } from '@/lib/geo/distance'
import { isCompassOctant, windIncludesDirection, type CompassOctant } from '@/lib/flightlog/wind'
import { hasKnownLocation } from '@/lib/flightlog/has-known-location'
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'

export type RegionOption = { regionId: number; name: string }

// 'all' rather than a bare number sentinel like -1 or 0 — 0 never appears in the regions
// list itself (Norway's 29 regions all carry positive ids), but it IS a real, meaningful
// value on takeoff rows, where it means "unassigned" (see UNREGIONED_LABEL below), and
// withUnregionedOptions turns that into a genuine, selectable RegionOption. Reusing bare 0
// as "no filter" would make selecting that Unregioned option indistinguishable from
// selecting no filter at all.
export type RegionFilter = number | 'all'

// 'all' rather than requiring a real octant for "no filter", same reasoning as RegionFilter
// above — the wind filter has no meaningful "unset" CompassOctant to reuse as a sentinel.
export type WindFilter = CompassOctant | 'all'

// Parses #12's `?wind=` URL query parameter into a validated WindFilter. Falls back to 'all'
// for anything absent or not a real compass octant (a stale, hand-edited, or malicious link),
// mirroring parseCuratedCountryId/isValidSearchQuery's own "return a safe default rather than
// throw on untrusted input" shape — this is exactly the case wind.ts's assertOctant guard was
// added for (see its own doc comment), except here the caller wants a fallback, not a throw.
export function parseWindFilterParam(value: string | undefined): WindFilter {
  return value !== undefined && isCompassOctant(value) ? value : 'all'
}

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

export type TakeoffMatch = TakeoffDirectoryEntry & {
  // Distance from the user's current position, in metres — null whenever "nearby" isn't in
  // play (no location yet, permission denied, unavailable). Present on every match either way
  // so a caller doesn't need a second type to render the common case and the located one.
  distanceMetres: number | null
}

// A narrower type than TakeoffMatch, used only internally for the branch where a distance is
// actually known — lets sortByDistance below compare `distanceMetres` as a plain `number`
// rather than asserting it non-null with `!`. Widens back to TakeoffMatch (number is
// assignable to number | null) the moment it's returned to a caller that doesn't care which
// branch produced it.
type LocatedTakeoff = TakeoffDirectoryEntry & { distanceMetres: number }

export type VisibleTakeoffs = {
  matches: TakeoffMatch[]
  totalMatchCount: number
  isTruncated: boolean
  // How many takeoffs that already passed the name/region filters have no recorded wind
  // (wind === 0) and are therefore excluded by the active wind filter — 0 whenever windFilter
  // is 'all', since nothing is being excluded on wind's account in that case. #12's decision:
  // silently dropping these behind a wind query is not acceptable, so this count exists
  // specifically so the caller can surface it, distinct from the ordinary "0 matches" case.
  windUnknownCount: number
  // How many takeoffs that already passed the name/region/wind filters carry a corrupt or
  // placeholder position (see hasKnownLocation for the three shapes that takes) and are
  // therefore shown WITHOUT a distance while nearby sort is active — 0 whenever userLocation
  // is null, since nothing is being sorted by distance at all in that case. Same decision as
  // windUnknownCount above, applied to the same shape of problem: 1948 of Norway's 6012
  // takeoffs (32.4%) carry the full lat=0/lon=0 placeholder alone, nearly twice as common as
  // missing wind, so pretending they have a real distance is not an edge case to skip — and
  // hasKnownLocation catches 7 more beyond that, corrupted in a different shape but reporting
  // the exact same wrong-distance failure.
  locationUnknownCount: number
}

// Pure — attaches each takeoff's great-circle distance from `from`, reusing the same haversine
// formula show-flight-track's altitude gradient already uses (see lib/geo/distance.ts) rather
// than a second implementation that could drift from it.
function withDistanceFrom(takeoffs: TakeoffDirectoryEntry[], from: GeoPoint): LocatedTakeoff[] {
  return takeoffs.map((takeoff) => ({ ...takeoff, distanceMetres: haversineDistanceMetres(from, takeoff) }))
}

function withoutDistance(takeoffs: TakeoffDirectoryEntry[]): TakeoffMatch[] {
  return takeoffs.map((takeoff) => ({ ...takeoff, distanceMetres: null }))
}

// Nearest-first once a location is known. Takes LocatedTakeoff, not TakeoffMatch, so
// `distanceMetres` is a plain `number` here — the caller only ever reaches this with the
// output of withDistanceFrom above, never withoutDistance's, so there is no runtime case to
// assert away.
function sortByDistance(takeoffs: LocatedTakeoff[]): LocatedTakeoff[] {
  return [...takeoffs].sort((a, b) => a.distanceMetres - b.distanceMetres)
}

// The directory's original order, before the user ever asks for "nearby" — also what it falls
// back to while a location isn't in hand yet (no request made, still pending, denied, or
// unavailable; see #12's decision that all of those are normal, not error, states).
function sortAlphabetically<T extends TakeoffDirectoryEntry>(takeoffs: T[]): T[] {
  return [...takeoffs].sort((a, b) => a.name.localeCompare(b.name))
}

// Nearby sort's own composition rule, mirroring the wind filter's "compose, never silently
// drop" decision: a takeoff with a real position sorts nearest-first as normal; one with a
// placeholder position (see hasKnownLocation) has no real distance to sort BY, so it is never
// fabricated one — it's appended after every located takeoff instead, in its own alphabetical
// order rather than fetch order (every placeholder currently computes to the SAME wrong
// distance from any user location, so without this they'd all tie and fall back to whatever
// order flightlog.org happened to serve them in).
function sortByDistanceThenUnknownLocationLast(takeoffs: TakeoffDirectoryEntry[], from: GeoPoint): TakeoffMatch[] {
  const located = takeoffs.filter(hasKnownLocation)
  const unlocated = takeoffs.filter((takeoff) => !hasKnownLocation(takeoff))
  return [...sortByDistance(withDistanceFrom(located, from)), ...sortAlphabetically(withoutDistance(unlocated))]
}

// Pure — no DOM, no fetch, so the whole filter/sort/cap/truncate pipeline is one thing to
// test without mounting a component. `foldedNames` is `foldTakeoffNames(takeoffs)`, supplied
// by the caller rather than computed here, so a caller that memoises it separately from
// `query` (see index.tsx) never pays the fold cost per keystroke — this function itself only
// folds the QUERY once per call, not once per row.
//
// The pipeline order matters and each step is deliberate:
// 1. Name and region filter first, same as before #12.
// 2. Wind filter next, over what's left — composes with name/region rather than replacing
//    them (#12's explicit requirement: applying wind must not ignore the active region). A
//    site with no recorded wind (wind === 0) can never satisfy a real octant query, by
//    construction of windIncludesDirection, so it's excluded here — and windUnknownCount
//    records exactly how many, before this step throws them away, so that exclusion stays
//    visible instead of silently shrinking the dataset.
// 3. Distance is attached and the set is sorted — BEFORE capping, never after: `matches` is
//    always the first MAX_RENDERED_RESULTS of the REAL, fully-filtered match set, not a slice
//    of a smaller or differently-ordered one. Which 200 of an over-the-cap match set get shown
//    is a user-visible decision (nearest 200, or alphabetically-first 200), not an accident of
//    fetch order. A takeoff with a placeholder position (lat=0/lon=0, see hasKnownLocation)
//    never receives a fabricated distance here — it sorts alphabetically after every located
//    takeoff instead, and locationUnknownCount records how many, same shape as
//    windUnknownCount above.
// 4. Cap and report truncation, over the post-filter, post-sort count — adding wind or nearby
//    never makes the truncation notice lie about what "the rest" actually is.
export function selectVisibleTakeoffs(
  takeoffs: TakeoffDirectoryEntry[],
  foldedNames: ReadonlyMap<number, string>,
  query: string,
  regionFilter: RegionFilter,
  windFilter: WindFilter = 'all',
  userLocation: GeoPoint | null = null,
): VisibleTakeoffs {
  const foldedQuery = foldForSearch(query)
  const nameAndRegionMatched = takeoffs.filter(
    (takeoff) =>
      (regionFilter === 'all' || takeoff.regionId === regionFilter) &&
      (foldedNames.get(takeoff.takeoffId) ?? '').includes(foldedQuery),
  )

  const windUnknownCount =
    windFilter === 'all' ? 0 : nameAndRegionMatched.filter((takeoff) => takeoff.wind === 0).length
  const windMatched =
    windFilter === 'all'
      ? nameAndRegionMatched
      : nameAndRegionMatched.filter((takeoff) => windIncludesDirection(takeoff.wind, windFilter))

  const locationUnknownCount = userLocation ? windMatched.filter((takeoff) => !hasKnownLocation(takeoff)).length : 0

  const sorted: TakeoffMatch[] = userLocation
    ? sortByDistanceThenUnknownLocationLast(windMatched, userLocation)
    : sortAlphabetically(withoutDistance(windMatched))

  return {
    matches: sorted.slice(0, MAX_RENDERED_RESULTS),
    totalMatchCount: sorted.length,
    isTruncated: sorted.length > MAX_RENDERED_RESULTS,
    windUnknownCount,
    locationUnknownCount,
  }
}
