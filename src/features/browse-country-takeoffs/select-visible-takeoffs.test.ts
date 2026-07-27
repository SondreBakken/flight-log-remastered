import { describe, expect, it } from 'vitest'
import {
  selectVisibleTakeoffs,
  foldTakeoffNames,
  withUnregionedOptions,
  sortRegionOptions,
  UNREGIONED_LABEL,
  MAX_RENDERED_RESULTS,
  type RegionOption,
} from './select-visible-takeoffs'
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'

function makeTakeoffs(count: number, namePrefix = 'Site', regionId = 1): TakeoffDirectoryEntry[] {
  return Array.from({ length: count }, (_, i) => ({ takeoffId: i, name: `${namePrefix}${i}`, regionId }))
}

// Test-only convenience: production code always supplies foldedNames from foldTakeoffNames
// itself (see index.tsx), memoised separately from the query — these tests exercise the
// selection pipeline's behaviour, not the memoisation boundary, so folding fresh each call is
// fine here.
function select(takeoffs: TakeoffDirectoryEntry[], query: string, regionFilter: Parameters<typeof selectVisibleTakeoffs>[3]) {
  return selectVisibleTakeoffs(takeoffs, foldTakeoffNames(takeoffs), query, regionFilter)
}

describe('selectVisibleTakeoffs', () => {
  it('filters by folded, substring name match', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'Bodø', regionId: 1 },
      { takeoffId: 2, name: 'Ålesund', regionId: 1 },
    ]

    const result = select(takeoffs, 'bodo', 'all')

    expect(result.matches.map((t) => t.takeoffId)).toEqual([1])
  })

  it('filters by region when a specific region is selected', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'Alpha', regionId: 1 },
      { takeoffId: 2, name: 'Beta', regionId: 2 },
    ]

    const result = select(takeoffs, '', 2)

    expect(result.matches.map((t) => t.takeoffId)).toEqual([2])
  })

  it('shows every takeoff when the region filter is "all", not just the first region', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'Alpha', regionId: 1 },
      { takeoffId: 2, name: 'Beta', regionId: 2 },
    ]

    const result = select(takeoffs, '', 'all')

    expect(result.matches.map((t) => t.takeoffId).sort()).toEqual([1, 2])
  })

  it('combines the name and region filters, not just one of them', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'Alpha', regionId: 1 },
      { takeoffId: 2, name: 'Alpha', regionId: 2 },
    ]

    const result = select(takeoffs, 'alpha', 2)

    expect(result.matches.map((t) => t.takeoffId)).toEqual([2])
  })

  // Pins the order deliberately, without deriving the expectation from the thing under test
  // (e.g. sorting the actual result before comparing it) — an unpinned order previously
  // survived the whole suite by reversing it, since the only prior order assertion sorted
  // its own actuals before comparing.
  it('orders matches alphabetically by name, not by fetch/array order', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'Zeta', regionId: 1 },
      { takeoffId: 2, name: 'Alpha', regionId: 1 },
      { takeoffId: 3, name: 'Mike', regionId: 1 },
    ]

    const result = select(takeoffs, '', 'all')

    expect(result.matches.map((t) => t.name)).toEqual(['Alpha', 'Mike', 'Zeta'])
  })

  it('the cap is exactly 200, chosen so a broad query still paints instantly with no virtualisation available in this repo', () => {
    expect(MAX_RENDERED_RESULTS).toBe(200)
  })

  it('caps the rendered matches at MAX_RENDERED_RESULTS but reports the true total match count', () => {
    const takeoffs = makeTakeoffs(MAX_RENDERED_RESULTS + 37)

    const result = select(takeoffs, '', 'all')

    expect(result.matches).toHaveLength(MAX_RENDERED_RESULTS)
    expect(result.totalMatchCount).toBe(MAX_RENDERED_RESULTS + 37)
    expect(result.isTruncated).toBe(true)
  })

  it('does not report truncation when the match count lands exactly at the cap', () => {
    const takeoffs = makeTakeoffs(MAX_RENDERED_RESULTS)

    const result = select(takeoffs, '', 'all')

    expect(result.matches).toHaveLength(MAX_RENDERED_RESULTS)
    expect(result.isTruncated).toBe(false)
  })

  it('does not report truncation for a normal small match count, the common case', () => {
    const takeoffs = makeTakeoffs(3)

    const result = select(takeoffs, '', 'all')

    expect(result.isTruncated).toBe(false)
    expect(result.totalMatchCount).toBe(3)
  })

  // Pins that filtering happens BEFORE capping: a huge unfiltered dataset, narrowed by the
  // query down to a single real match, must never be reported as truncated just because the
  // dataset it was drawn from was bigger than the cap.
  it('filters before capping — a filtered-down match set under the cap is never falsely marked truncated', () => {
    const haystack = makeTakeoffs(MAX_RENDERED_RESULTS + 500, 'Zzz')
    const takeoffs = [...haystack, { takeoffId: 999_999, name: 'UniqueMatch', regionId: 1 }]

    const result = select(takeoffs, 'uniquematch', 'all')

    expect(result.totalMatchCount).toBe(1)
    expect(result.isTruncated).toBe(false)
    expect(result.matches).toHaveLength(1)
  })
})

describe('foldTakeoffNames', () => {
  it('folds every name once, keyed by takeoffId', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'Bodø', regionId: 1 },
      { takeoffId: 2, name: 'Ålesund', regionId: 1 },
    ]

    const folded = foldTakeoffNames(takeoffs)

    expect(folded.get(1)).toBe('bodo')
    expect(folded.get(2)).toBe('alesund')
  })
})

describe('withUnregionedOptions', () => {
  it('adds no synthetic option when every takeoff has a known region', () => {
    const regions: RegionOption[] = [{ regionId: 1, name: 'Østlandet' }]
    const takeoffs: TakeoffDirectoryEntry[] = [{ takeoffId: 1, name: 'Alpha', regionId: 1 }]

    expect(withUnregionedOptions(regions, takeoffs)).toEqual(regions)
  })

  // Pins the actual defect: flightlog.org's own regionId 0 convention (no matching entry in
  // the fetched region list) must become a real, selectable dropdown entry, not a silent gap
  // only reachable through "All regions."
  it('adds a synthetic UNREGIONED_LABEL option for a regionId absent from the fetched regions', () => {
    const regions: RegionOption[] = [{ regionId: 1, name: 'Østlandet' }]
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'Alpha', regionId: 1 },
      { takeoffId: 2, name: 'Orphan', regionId: 0 },
    ]

    expect(withUnregionedOptions(regions, takeoffs)).toEqual([
      { regionId: 1, name: 'Østlandet' },
      { regionId: 0, name: UNREGIONED_LABEL },
    ])
  })

  it('adds exactly one synthetic option per distinct orphan regionId, not one per orphaned takeoff', () => {
    const regions: RegionOption[] = []
    const takeoffs: TakeoffDirectoryEntry[] = [
      { takeoffId: 1, name: 'A', regionId: 0 },
      { takeoffId: 2, name: 'B', regionId: 0 },
      { takeoffId: 3, name: 'C', regionId: 0 },
    ]

    expect(withUnregionedOptions(regions, takeoffs)).toEqual([{ regionId: 0, name: UNREGIONED_LABEL }])
  })
})

describe('sortRegionOptions', () => {
  // Asserted against a hardcoded expected order, not by sorting the actual result before
  // comparing — the latter shape would pass even if the function under test did nothing.
  it('sorts region options by name, per String.prototype.localeCompare', () => {
    const regions: RegionOption[] = [
      { regionId: 3, name: 'Østlandet' },
      { regionId: 1, name: 'Agder' },
      { regionId: 2, name: 'Vestlandet' },
    ]

    // Hardcoded, not derived by sorting the input again — that would pass even if
    // sortRegionOptions did nothing. This repo's dropdown never specifies a locale, so the
    // runtime's default collation applies (which folds ø near o), not "true Norwegian
    // alphabetical order" (which places æøå after z) — Østlandet lands before Vestlandet here.
    expect(sortRegionOptions(regions).map((r) => r.name)).toEqual(['Agder', 'Østlandet', 'Vestlandet'])
  })

  it('does not mutate the input array', () => {
    const regions: RegionOption[] = [
      { regionId: 2, name: 'Vestlandet' },
      { regionId: 1, name: 'Agder' },
    ]

    sortRegionOptions(regions)

    expect(regions.map((r) => r.regionId)).toEqual([2, 1])
  })
})
