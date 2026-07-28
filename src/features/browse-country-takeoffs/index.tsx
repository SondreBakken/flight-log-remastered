'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTakeoffs, type TakeoffsState } from './use-takeoffs'
import { useNearby } from './use-nearby'
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'
import { OCTANTS_CLOCKWISE } from '@/lib/flightlog/wind'
import type { GeoPoint } from '@/lib/geo/distance'
import {
  selectVisibleTakeoffs,
  foldTakeoffNames,
  withUnregionedOptions,
  sortRegionOptions,
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
  // Seeded from the page's own `?wind=` query parameter (already validated server-side — see
  // page.tsx and select-visible-takeoffs.ts's parseWindFilterParam), so a shared link opens
  // straight into the filtered view instead of the user having to reselect it. 'all' when the
  // route is visited with no param at all, matching every other filter's default.
  initialWindFilter?: WindFilter
}

// No takeoffs to show yet at module scope, not `[]` re-allocated inline on every render —
// keeps memoisation below referentially stable while state.status isn't 'success'.
const NO_TAKEOFFS: TakeoffDirectoryEntry[] = []

function formatDistanceKm(distanceMetres: number): string {
  return `${(distanceMetres / 1000).toFixed(1)} km`
}

// Keeps the address bar in sync with the wind filter without pulling Next's router into a
// component that has no actual navigation to perform — nothing here changes route, triggers a
// server render, or needs next/navigation's Suspense-boundary rules (see page.tsx, which is
// the one place that DOES need those, for the opposite direction: reading the initial value).
// `replaceState`, not `pushState`: picking a new direction is a filter edit, not a page the
// user would expect the back button to step through one octant at a time.
function syncWindFilterToUrl(windFilter: WindFilter): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (windFilter === 'all') url.searchParams.delete('wind')
  else url.searchParams.set('wind', windFilter)
  window.history.replaceState(null, '', url)
}

// #9's directory, replacing #38's proof-of-mechanism preview — that component's own comment
// said as much: "the moment this grows an input with live filtering it is #9". #12 adds wind
// direction and nearby-me on top of the same pipeline. Filtering runs entirely against
// `state.takeoffs`, the same array the browser already fetched once from the prerendered
// takeoffs route — no per-keystroke or per-filter-change network request, and geolocation is a
// browser API call, not a request to flightlog.org either.
export default function TakeoffDirectory({ countryId, countryName, regions, initialWindFilter = 'all' }: TakeoffDirectoryProps) {
  const state = useTakeoffs(countryId)
  const [query, setQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState<RegionFilter>('all')
  const [windFilter, setWindFilter] = useState<WindFilter>(initialWindFilter)
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

  const handleNearbyToggle = useCallback(
    (checked: boolean) => {
      setNearbyEnabled(checked)
      if (checked && nearby.status === 'idle') nearby.requestNearby()
    },
    [nearby],
  )

  // Distance sorting is layered on top of a list that already works — it only ever applies
  // once a real location is in hand, never while pending, denied, or unavailable, matching
  // #12's decision that geolocation refusal, unavailability, and delay are all normal paths,
  // not error states that should block or degrade the rest of the directory.
  const userLocation: GeoPoint | null = nearbyEnabled && nearby.status === 'granted' ? nearby.location : null

  const takeoffs = state.status === 'success' ? state.takeoffs : NO_TAKEOFFS
  // Only the dropdown needs this: a <select> can't fall back to a label the way a rendered
  // row can (see UNREGIONED_LABEL's own doc comment for that fallback), it needs an actual
  // selectable <option> — `regions` alone would silently make any takeoff whose regionId
  // flightlog.org never registered reachable only through "All regions."
  const regionsWithUnregioned = useMemo(() => withUnregionedOptions(regions, takeoffs), [regions, takeoffs])

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{countryName} takeoffs</h1>
        <TakeoffCountSummary state={state} />
      </header>
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
    </section>
  )
}

function TakeoffCountSummary({ state }: { state: TakeoffsState }) {
  if (state.status !== 'success') return null
  return <p className="text-sm opacity-70">{state.takeoffs.length} takeoffs</p>
}

// Refusal, unavailability, and "still asking" are all normal, expected rests for this control
// — none of them render as an error, each just tells the user why distance sort isn't active
// yet (or won't be), while the rest of the directory keeps working underneath unchanged.
function NearbyStatusHint({ enabled, status }: { enabled: boolean; status: ReturnType<typeof useNearby>['status'] }) {
  if (!enabled) return null
  if (status === 'pending') return <span className="text-xs opacity-70">Locating…</span>
  if (status === 'denied') return <span className="text-xs opacity-70">Location permission denied — showing all sites</span>
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
  nearbyStatus: ReturnType<typeof useNearby>['status']
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
          onChange={(event) => onWindFilterChange(event.target.value as WindFilter)}
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
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={nearbyEnabled}
          onChange={(event) => onNearbyToggle(event.target.checked)}
          aria-label="Nearby"
        />
        Sort by distance from me
        <NearbyStatusHint enabled={nearbyEnabled} status={nearbyStatus} />
      </label>
    </div>
  )
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
  const { matches, totalMatchCount, isTruncated, windUnknownCount } = useMemo(
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
        <p className="text-sm opacity-70">
          {windUnknownCount} matching {windUnknownCount === 1 ? 'site has' : 'sites have'} no recorded wind direction and{' '}
          {windUnknownCount === 1 ? 'is' : 'are'} excluded from this filter.
        </p>
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
// cause instead; a query IS blamed once one was actually typed, region filter or not.
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
  const message =
    query !== ''
      ? `No takeoffs match “${query}”.`
      : regionFilter !== 'all'
        ? `No takeoffs recorded in ${regionName}.`
        : windFilter !== 'all'
          ? `No takeoffs recorded that work in ${windFilter}.`
          : 'No takeoffs recorded.'

  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      {message}
      {windFilter !== 'all' && windUnknownCount > 0 && (
        <>
          {' '}
          {windUnknownCount} otherwise-matching {windUnknownCount === 1 ? 'site has' : 'sites have'} no recorded wind and{' '}
          {windUnknownCount === 1 ? 'is' : 'are'} excluded.
        </>
      )}
    </p>
  )
}
