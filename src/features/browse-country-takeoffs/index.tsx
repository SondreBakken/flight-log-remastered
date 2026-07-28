'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTakeoffs, type TakeoffsState } from './use-takeoffs'
import { useNearby, type NearbyStatus } from './use-nearby'
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'
import { TakeoffsMap } from './takeoffs-map'
import { OCTANTS_CLOCKWISE } from '@/lib/flightlog/wind'
import type { GeoPoint } from '@/lib/geo/distance'
import {
  selectVisibleTakeoffs,
  foldTakeoffNames,
  withUnregionedOptions,
  sortRegionOptions,
  parseWindFilterParam,
  UNREGIONED_LABEL,
  MAX_RENDERED_RESULTS,
  type RegionFilter,
  type RegionOption,
  type TakeoffMatch,
  type WindFilter,
} from './select-visible-takeoffs'

type TakeoffDirectoryProps = {
  countryId: number
  countryName: string
  regions: RegionOption[]
}

// No takeoffs to show yet at module scope, not `[]` re-allocated inline on every render —
// keeps memoisation below referentially stable while state.status isn't 'success'.
const NO_TAKEOFFS: TakeoffDirectoryEntry[] = []

function formatDistanceKm(distanceMetres: number): string {
  return `${(distanceMetres / 1000).toFixed(1)} km`
}

// Extracted so the "must respect the checkbox, not just a stale granted status" rule is
// pinned directly, independent of whatever else happens to reset `status` elsewhere (see
// handleNearbyToggle's own stopNearby call) — distance sorting is layered on top of a list
// that already works, applying only once BOTH the user asked for it AND a real location is in
// hand, never from either alone.
export function resolveUserLocation(nearbyEnabled: boolean, nearbyStatus: NearbyStatus, location: GeoPoint | null): GeoPoint | null {
  return nearbyEnabled && nearbyStatus === 'granted' ? location : null
}

// Keeps the address bar in sync with the wind filter without pulling Next's router into a
// component that has no actual navigation to perform — nothing here changes route, triggers a
// server render, or needs next/navigation's Suspense-boundary rules. `replaceState`, not
// `pushState`: picking a new direction is a filter edit, not a page the user would expect the
// back button to step through one octant at a time.
function syncWindFilterToUrl(windFilter: WindFilter): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (windFilter === 'all') url.searchParams.delete('wind')
  else url.searchParams.set('wind', windFilter)
  window.history.replaceState(null, '', url)
}

// The read counterpart of syncWindFilterToUrl above, used once, as windFilter's own useState
// initialiser — deliberately NOT read server-side (see page.tsx, which no longer touches
// `?wind=` at all). This component already fetches its takeoff data client-side (see
// useTakeoffs), so the filtered list is never part of the server-rendered/prerendered shell
// either way; the only thing a server-seeded value used to buy was the wind <select>'s initial
// value matching the URL a fraction of a second sooner, at the cost of pulling searchParams
// (and therefore a Suspense boundary around this entire component, all 6012 rows of client
// component included) into what was otherwise a fully static, build-time-prerenderable page —
// measured at 8470 characters of postponed shell for one select's default, against 0 for the
// sibling country page with no searchParams dependency at all. Reading it here instead, in a
// lazy useState initialiser, costs nothing server-side (the ternary below is the whole price)
// and runs before the browser's first paint on the client, so a shared link still opens
// straight into the filtered view — just resolved here instead of on the server.
function readWindFilterFromUrl(): WindFilter {
  if (typeof window === 'undefined') return 'all'
  return parseWindFilterParam(new URL(window.location.href).searchParams.get('wind') ?? undefined)
}

// #9's directory, replacing #38's proof-of-mechanism preview — that component's own comment
// said as much: "the moment this grows an input with live filtering it is #9". #12 adds wind
// direction and nearby-me on top of the same pipeline. Filtering runs entirely against
// `state.takeoffs`, the same array the browser already fetched once from the prerendered
// takeoffs route — no per-keystroke or per-filter-change network request, and geolocation is a
// browser API call, not a request to flightlog.org either.
// 'list' first — the directory's original view, unchanged by #10, so a caller who never
// touches the new toggle sees exactly the same page as before.
type DirectoryView = 'list' | 'map'

export default function TakeoffDirectory({ countryId, countryName, regions }: TakeoffDirectoryProps) {
  const state = useTakeoffs(countryId)
  const [view, setView] = useState<DirectoryView>('list')
  const [query, setQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState<RegionFilter>('all')
  const [windFilter, setWindFilter] = useState<WindFilter>(readWindFilterFromUrl)
  const nearby = useNearby()
  // Separate from `nearby.status` on purpose: the user's INTENT to sort by distance survives
  // a denial or an unavailable browser (so the explanatory copy below stays visible instead of
  // disappearing the moment the request settles), and unchecking the box must stop applying
  // distance sort without discarding the already-granted permission or forcing a new prompt if
  // it's re-checked.
  const [nearbyEnabled, setNearbyEnabled] = useState(false)

  const handleWindFilterChange = useCallback((next: WindFilter) => {
    setWindFilter(next)
    syncWindFilterToUrl(next)
  }, [])

  // Corrects the address bar once on mount for a link that arrived with an invalid `?wind=`
  // value (hand-edited, stale, or malicious) — readWindFilterFromUrl's lazy initialiser above
  // already falls back to 'all' for STATE, but never touches the URL itself, so re-sharing the
  // link would keep propagating a parameter the directory never actually honoured. A valid
  // param makes this a no-op replaceState call to the URL it's already at.
  useEffect(() => {
    syncWindFilterToUrl(windFilter)
    // Mount-only correction; every later change already goes through
    // handleWindFilterChange's own sync above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleNearbyToggle = useCallback(
    (checked: boolean) => {
      setNearbyEnabled(checked)
      if (checked) {
        if (nearby.status === 'idle') nearby.requestNearby()
      } else {
        // Unchecking must actually stop the watch, not just stop READING from it — see
        // use-nearby's own stopNearby doc comment. Resetting to 'idle' here is also what lets
        // a later re-check retry cleanly after a 'denied', 'unavailable' or 'timeout' rest,
        // none of which requestNearby's own 'idle' gate would otherwise ever revisit.
        nearby.stopNearby()
      }
    },
    [nearby],
  )

  // Distance sorting is layered on top of a list that already works — it only ever applies
  // once a real location is in hand, never while pending, denied, or unavailable, matching
  // #12's decision that geolocation refusal, unavailability, and delay are all normal paths,
  // not error states that should block or degrade the rest of the directory.
  const userLocation: GeoPoint | null = resolveUserLocation(nearbyEnabled, nearby.status, nearby.location)

  const takeoffs = state.status === 'success' ? state.takeoffs : NO_TAKEOFFS
  // Only the dropdown needs this: a <select> can't fall back to a label the way a rendered
  // row can (see UNREGIONED_LABEL's own doc comment for that fallback), it needs an actual
  // selectable <option> — `regions` alone would silently make any takeoff whose regionId
  // flightlog.org never registered reachable only through "All regions."
  const regionsWithUnregioned = useMemo(() => withUnregionedOptions(regions, takeoffs), [regions, takeoffs])

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{countryName} takeoffs</h1>
          <ViewToggle view={view} onViewChange={setView} />
        </div>
        <TakeoffCountSummary state={state} />
      </header>
      {view === 'map' ? (
        <TakeoffsMapSection state={state} takeoffs={takeoffs} />
      ) : (
        <>
          <SearchControls
            query={query}
            onQueryChange={setQuery}
            regions={regionsWithUnregioned}
            regionFilter={regionFilter}
            onRegionFilterChange={setRegionFilter}
            windFilter={windFilter}
            onWindFilterChange={handleWindFilterChange}
            nearbyEnabled={nearbyEnabled}
            onNearbyToggle={handleNearbyToggle}
            nearbyStatus={nearby.status}
          />
          <TakeoffResults
            state={state}
            takeoffs={takeoffs}
            query={query}
            regionFilter={regionFilter}
            windFilter={windFilter}
            userLocation={userLocation}
            regions={regions}
          />
        </>
      )}
    </section>
  )
}

// Reuses the SAME `takeoffs` array useTakeoffs already fetched (see index.tsx's own doc
// comment on why: the dataset is already resident in the browser) — switching to the map view
// never issues a second request, it just hands the one array this component already holds to
// a different renderer.
function ViewToggle({ view, onViewChange }: { view: DirectoryView; onViewChange: (view: DirectoryView) => void }) {
  return (
    <div role="group" aria-label="Directory view" className="flex gap-1 rounded border border-black/20 p-0.5 text-sm dark:border-white/25">
      <button
        type="button"
        aria-pressed={view === 'list'}
        onClick={() => onViewChange('list')}
        className={classes('rounded px-2 py-1', view === 'list' && 'bg-black/10 dark:bg-white/15')}
      >
        List
      </button>
      <button
        type="button"
        aria-pressed={view === 'map'}
        onClick={() => onViewChange('map')}
        className={classes('rounded px-2 py-1', view === 'map' && 'bg-black/10 dark:bg-white/15')}
      >
        Map
      </button>
    </div>
  )
}

function classes(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function TakeoffsMapSection({ state, takeoffs }: { state: TakeoffsState; takeoffs: TakeoffDirectoryEntry[] }) {
  if (state.status === 'loading') return <p className="text-sm opacity-70">Loading takeoffs…</p>
  if (state.status === 'error') return <p className="text-sm text-red-600">{state.message}</p>
  return <TakeoffsMap takeoffs={takeoffs} />
}

function TakeoffCountSummary({ state }: { state: TakeoffsState }) {
  if (state.status !== 'success') return null
  return <p className="text-sm opacity-70">{state.takeoffs.length} takeoffs</p>
}

// Refusal, unavailability, and "still asking" are all normal, expected rests for this control
// — none of them render as an error, each just tells the user why distance sort isn't active
// yet (or won't be), while the rest of the directory keeps working underneath unchanged.
function NearbyStatusHint({ enabled, status }: { enabled: boolean; status: NearbyStatus }) {
  if (!enabled) return null
  if (status === 'pending') return <span className="text-xs opacity-70">Locating…</span>
  if (status === 'denied') return <span className="text-xs opacity-70">Location permission denied — showing all sites</span>
  if (status === 'timeout') return <span className="text-xs opacity-70">Location request timed out — uncheck and check again to retry</span>
  if (status === 'unavailable') return <span className="text-xs opacity-70">Location unavailable in this browser</span>
  return null
}

function SearchControls({
  query,
  onQueryChange,
  regions,
  regionFilter,
  onRegionFilterChange,
  windFilter,
  onWindFilterChange,
  nearbyEnabled,
  onNearbyToggle,
  nearbyStatus,
}: {
  query: string
  onQueryChange: (value: string) => void
  regions: RegionOption[]
  regionFilter: RegionFilter
  onRegionFilterChange: (value: RegionFilter) => void
  windFilter: WindFilter
  onWindFilterChange: (value: WindFilter) => void
  nearbyEnabled: boolean
  onNearbyToggle: (checked: boolean) => void
  nearbyStatus: NearbyStatus
}) {
  const sortedRegions = useMemo(() => sortRegionOptions(regions), [regions])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Filter by name"
          aria-label="Takeoff name"
          className="flex-1 rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
        />
        <select
          value={regionFilter}
          onChange={(event) => onRegionFilterChange(event.target.value === 'all' ? 'all' : Number(event.target.value))}
          aria-label="Region"
          className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
        >
          <option value="all">All regions</option>
          {sortedRegions.map((region) => (
            <option key={region.regionId} value={region.regionId}>
              {region.name}
            </option>
          ))}
        </select>
        <select
          value={windFilter}
          onChange={(event) => onWindFilterChange(parseWindFilterParam(event.target.value))}
          aria-label="Wind direction"
          className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
        >
          <option value="all">Any wind</option>
          {OCTANTS_CLOCKWISE.map((octant) => (
            <option key={octant} value={octant}>
              Works in {octant}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={nearbyEnabled}
            onChange={(event) => onNearbyToggle(event.target.checked)}
          />
          Sort by distance from me
        </label>
        <NearbyStatusHint enabled={nearbyEnabled} status={nearbyStatus} />
      </div>
    </div>
  )
}

// #12's decision (see buildEmptyStateMessage below for the sibling composition rule): excluding
// sites with no recorded wind must never be silent, and the list view's own notice and the
// empty state's appended clause must say exactly the same thing about it — a single shared
// string is what makes that true BY CONSTRUCTION, rather than by two hand-kept-in-sync copies
// (see #12's own review, which caught them having drifted: "matching" on one side, the more
// precise "otherwise-matching" — these sites already passed name/region, wind is the only
// reason they're gone — on the other).
function windExclusionMessage(windUnknownCount: number): string {
  const siteWord = windUnknownCount === 1 ? 'site has' : 'sites have'
  const isAre = windUnknownCount === 1 ? 'is' : 'are'
  return `${windUnknownCount} otherwise-matching ${siteWord} no recorded wind and ${isAre} excluded.`
}

// D1's decision, the same shape as windExclusionMessage above applied to the nearby sort
// instead of the wind filter: a site with no recorded position (see hasKnownLocation in
// select-visible-takeoffs.ts) never gets a fabricated distance, but it also isn't dropped from
// the list the way a wind-filtered-out site is — nearby only ever SORTS, it never removes a
// match — so the wording says "shown without a distance", not "excluded".
function locationUnknownMessage(locationUnknownCount: number): string {
  const siteWord = locationUnknownCount === 1 ? 'site has' : 'sites have'
  const isAre = locationUnknownCount === 1 ? 'is' : 'are'
  return `${locationUnknownCount} matching ${siteWord} no recorded location and ${isAre} shown without a distance, after the located sites.`
}

function TakeoffResults({
  state,
  takeoffs,
  query,
  regionFilter,
  windFilter,
  userLocation,
  regions,
}: {
  state: TakeoffsState
  takeoffs: TakeoffDirectoryEntry[]
  query: string
  regionFilter: RegionFilter
  windFilter: WindFilter
  userLocation: GeoPoint | null
  regions: RegionOption[]
}) {
  // All hooks run on every render regardless of state.status, so the branches below (which
  // return early) never change how many hooks this component calls — the values they compute
  // are simply unused while loading or errored.
  const regionNameById = useMemo(() => new Map(regions.map((region) => [region.regionId, region.name])), [regions])
  // Keyed on `takeoffs` alone, not on `query` — `takeoffs` is referentially stable for the
  // component's whole lifetime (one fetch, never refetched), so this fold runs once per
  // dataset, not once per keystroke. See foldTakeoffNames' own doc comment for the measured
  // cost this avoids.
  const foldedNames = useMemo(() => foldTakeoffNames(takeoffs), [takeoffs])
  const { matches, totalMatchCount, isTruncated, windUnknownCount, locationUnknownCount } = useMemo(
    () => selectVisibleTakeoffs(takeoffs, foldedNames, query, regionFilter, windFilter, userLocation),
    [takeoffs, foldedNames, query, regionFilter, windFilter, userLocation],
  )

  if (state.status === 'loading') return <p className="text-sm opacity-70">Loading takeoffs…</p>
  if (state.status === 'error') return <p className="text-sm text-red-600">{state.message}</p>

  if (totalMatchCount === 0) {
    const regionName = regionFilter === 'all' ? undefined : (regionNameById.get(regionFilter) ?? UNREGIONED_LABEL)
    return (
      <EmptyState query={query} regionFilter={regionFilter} regionName={regionName} windFilter={windFilter} windUnknownCount={windUnknownCount} />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {isTruncated && (
        <p className="text-sm opacity-70">
          Showing {MAX_RENDERED_RESULTS} of {totalMatchCount} matches. Refine your search to see the rest.
        </p>
      )}
      {/* #12's decision: excluding sites with no recorded wind must never be silent. Shown
          whenever a real direction is selected and at least one otherwise-matching site was
          dropped for lacking data, distinct from the ordinary truncation notice above. */}
      {windFilter !== 'all' && windUnknownCount > 0 && (
        <p className="text-sm opacity-70">{windExclusionMessage(windUnknownCount)}</p>
      )}
      {/* D1: a site with no recorded position must never be shown with a fabricated distance
          while nearby sort is active — see locationUnknownMessage's own doc comment. */}
      {userLocation !== null && locationUnknownCount > 0 && (
        <p className="text-sm opacity-70">{locationUnknownMessage(locationUnknownCount)}</p>
      )}
      {/* Name rendered as plain text, not a Link — a site page to link to is #11, not this
          route, and #4/#6 already established the pattern of leaving that affordance out
          rather than linking to a route that doesn't exist yet. */}
      <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
        {matches.map((takeoff) => (
          <TakeoffRow key={takeoff.takeoffId} takeoff={takeoff} regionName={regionNameById.get(takeoff.regionId) ?? UNREGIONED_LABEL} />
        ))}
      </ul>
    </div>
  )
}

function TakeoffRow({ takeoff, regionName }: { takeoff: TakeoffMatch; regionName: string }) {
  return (
    <li className="flex justify-between gap-4 py-2 text-sm">
      <span>{takeoff.name}</span>
      <span className="flex gap-3 opacity-70">
        {takeoff.distanceMetres !== null && <span>{formatDistanceKm(takeoff.distanceMetres)}</span>}
        <span>{regionName}</span>
      </span>
    </li>
  )
}

// A blank query is not something the user typed — it's what's left after they picked a
// region with zero takeoffs without touching the search box, or the directory is genuinely
// empty. `No takeoffs match ""` blames a query that was never entered; this names the actual
// cause instead.
//
// All three filters that can DROP a match (query, region, wind — "nearby" only sorts, it
// never removes a row, so it plays no part here) compose into one message rather than one
// replacing the others: a region-plus-wind search with zero results has TWO actual causes,
// and naming only the first (as an if/else-if chain picking one branch would) makes the
// other look like it was never applied at all. See B1 in the branch's own review — that
// was exactly this bug: selecting a region, then a wind direction, blamed the region alone.
function buildEmptyStateMessage(query: string, regionFilter: RegionFilter, regionName: string | undefined, windFilter: WindFilter): string {
  const verb = query !== '' ? `match “${query}”` : 'recorded'
  const regionClause = regionFilter !== 'all' ? ` in ${regionName}` : ''
  const windClause = windFilter !== 'all' ? ` that work in ${windFilter}` : ''
  return `No takeoffs ${verb}${regionClause}${windClause}.`
}

function EmptyState({
  query,
  regionFilter,
  regionName,
  windFilter,
  windUnknownCount,
}: {
  query: string
  regionFilter: RegionFilter
  regionName: string | undefined
  windFilter: WindFilter
  windUnknownCount: number
}) {
  const message = buildEmptyStateMessage(query, regionFilter, regionName, windFilter)

  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      {message}
      {windFilter !== 'all' && windUnknownCount > 0 && <> {windExclusionMessage(windUnknownCount)}</>}
    </p>
  )
}
