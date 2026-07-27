'use client'

import { useMemo, useState } from 'react'
import { useTakeoffs, type TakeoffsState } from './use-takeoffs'
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'
import {
  selectVisibleTakeoffs,
  foldTakeoffNames,
  withUnregionedOptions,
  sortRegionOptions,
  UNREGIONED_LABEL,
  MAX_RENDERED_RESULTS,
  type RegionFilter,
  type RegionOption,
} from './select-visible-takeoffs'

type TakeoffDirectoryProps = {
  countryId: number
  countryName: string
  regions: RegionOption[]
}

// No takeoffs to show yet at module scope, not `[]` re-allocated inline on every render —
// keeps memoisation below referentially stable while state.status isn't 'success'.
const NO_TAKEOFFS: TakeoffDirectoryEntry[] = []

// #9's directory, replacing #38's proof-of-mechanism preview (that component's own comment
// said as much: "the moment this grows an input with live filtering it is #9"). Filtering
// runs entirely against `state.takeoffs`, the same array the browser already fetched once
// from the prerendered takeoffs route — no per-keystroke network request.
export default function TakeoffDirectory({ countryId, countryName, regions }: TakeoffDirectoryProps) {
  const state = useTakeoffs(countryId)
  const [query, setQuery] = useState('')
  const [regionFilter, setRegionFilter] = useState<RegionFilter>('all')

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
      />
      <TakeoffResults state={state} takeoffs={takeoffs} query={query} regionFilter={regionFilter} regions={regions} />
    </section>
  )
}

function TakeoffCountSummary({ state }: { state: TakeoffsState }) {
  if (state.status !== 'success') return null
  return <p className="text-sm opacity-70">{state.takeoffs.length} takeoffs</p>
}

function SearchControls({
  query,
  onQueryChange,
  regions,
  regionFilter,
  onRegionFilterChange,
}: {
  query: string
  onQueryChange: (value: string) => void
  regions: RegionOption[]
  regionFilter: RegionFilter
  onRegionFilterChange: (value: RegionFilter) => void
}) {
  const sortedRegions = useMemo(() => sortRegionOptions(regions), [regions])

  return (
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
    </div>
  )
}

function TakeoffResults({
  state,
  takeoffs,
  query,
  regionFilter,
  regions,
}: {
  state: TakeoffsState
  takeoffs: TakeoffDirectoryEntry[]
  query: string
  regionFilter: RegionFilter
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
  const { matches, totalMatchCount, isTruncated } = useMemo(
    () => selectVisibleTakeoffs(takeoffs, foldedNames, query, regionFilter),
    [takeoffs, foldedNames, query, regionFilter],
  )

  if (state.status === 'loading') return <p className="text-sm opacity-70">Loading takeoffs…</p>
  if (state.status === 'error') return <p className="text-sm text-red-600">{state.message}</p>

  if (totalMatchCount === 0) {
    const regionName = regionFilter === 'all' ? undefined : (regionNameById.get(regionFilter) ?? UNREGIONED_LABEL)
    return <EmptyState query={query} regionFilter={regionFilter} regionName={regionName} />
  }

  return (
    <div className="flex flex-col gap-2">
      {isTruncated && (
        <p className="text-sm opacity-70">
          Showing {MAX_RENDERED_RESULTS} of {totalMatchCount} matches. Refine your search to see the rest.
        </p>
      )}
      {/* Name rendered as plain text, not a Link — a site page to link to is #11, not this
          route, and #4/#6 already established the pattern of leaving that affordance out
          rather than linking to a route that doesn't exist yet. */}
      <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/10">
        {matches.map((takeoff) => (
          <li key={takeoff.takeoffId} className="flex justify-between gap-4 py-2 text-sm">
            <span>{takeoff.name}</span>
            <span className="opacity-70">{regionNameById.get(takeoff.regionId) ?? UNREGIONED_LABEL}</span>
          </li>
        ))}
      </ul>
    </div>
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
}: {
  query: string
  regionFilter: RegionFilter
  regionName: string | undefined
}) {
  const message =
    query !== ''
      ? `No takeoffs match “${query}”.`
      : regionFilter !== 'all'
        ? `No takeoffs recorded in ${regionName}.`
        : 'No takeoffs recorded.'

  return (
    <p className="rounded-md border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
      {message}
    </p>
  )
}
