import { describe, expect, it } from 'vitest'
import {
  selectVisibleTakeoffs,
  foldTakeoffNames,
  withUnregionedOptions,
  sortRegionOptions,
  parseWindFilterParam,
  UNREGIONED_LABEL,
  MAX_RENDERED_RESULTS,
  type RegionOption,
  type WindFilter,
} from './select-visible-takeoffs'
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'

// Neutral, realistic defaults for the fields most tests in this file don't care about — a real
// in-range lat/lon and wind=0 (no recorded directions), overridable per fixture. wind=0, not
// 255, is deliberate: 255 ("works in every direction") would make every wind-filter test that
// doesn't explicitly set wind pass vacuously, which is exactly the "fixture too tame to express
// the property" shape to avoid.
function makeTakeoff(overrides: Partial<TakeoffDirectoryEntry> & Pick<TakeoffDirectoryEntry, 'takeoffId' | 'name'>): TakeoffDirectoryEntry {
  return { regionId: 1, lat: 60, lon: 10, wind: 0, ...overrides }
}

function makeTakeoffs(count: number, namePrefix = 'Site', regionId = 1): TakeoffDirectoryEntry[] {
  return Array.from({ length: count }, (_, i) => makeTakeoff({ takeoffId: i, name: `${namePrefix}${i}`, regionId }))
}

// Test-only convenience: production code always supplies foldedNames from foldTakeoffNames
// itself (see index.tsx), memoised separately from the query — these tests exercise the
// selection pipeline's behaviour, not the memoisation boundary, so folding fresh each call is
// fine here.
function select(
  takeoffs: TakeoffDirectoryEntry[],
  query: string,
  regionFilter: Parameters<typeof selectVisibleTakeoffs>[3],
  windFilter?: WindFilter,
  userLocation?: Parameters<typeof selectVisibleTakeoffs>[5],
) {
  return selectVisibleTakeoffs(takeoffs, foldTakeoffNames(takeoffs), query, regionFilter, windFilter, userLocation)
}

describe('selectVisibleTakeoffs', () => {
  it('filters by folded, substring name match', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      makeTakeoff({ takeoffId: 1, name: 'Bodø' }),
      makeTakeoff({ takeoffId: 2, name: 'Ålesund' }),
    ]

    const result = select(takeoffs, 'bodo', 'all')

    expect(result.matches.map((t) => t.takeoffId)).toEqual([1])
  })

  it('filters by region when a specific region is selected', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      makeTakeoff({ takeoffId: 1, name: 'Alpha', regionId: 1 }),
      makeTakeoff({ takeoffId: 2, name: 'Beta', regionId: 2 }),
    ]

    const result = select(takeoffs, '', 2)

    expect(result.matches.map((t) => t.takeoffId)).toEqual([2])
  })

  it('shows every takeoff when the region filter is "all", not just the first region', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      makeTakeoff({ takeoffId: 1, name: 'Alpha', regionId: 1 }),
      makeTakeoff({ takeoffId: 2, name: 'Beta', regionId: 2 }),
    ]

    const result = select(takeoffs, '', 'all')

    expect(result.matches.map((t) => t.takeoffId).sort()).toEqual([1, 2])
  })

  it('combines the name and region filters, not just one of them', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      makeTakeoff({ takeoffId: 1, name: 'Alpha', regionId: 1 }),
      makeTakeoff({ takeoffId: 2, name: 'Alpha', regionId: 2 }),
    ]

    const result = select(takeoffs, 'alpha', 2)

    expect(result.matches.map((t) => t.takeoffId)).toEqual([2])
  })

  // Pins the order deliberately, without deriving the expectation from the thing under test
  // (e.g. sorting the actual result before comparing it) — an unpinned order previously
  // survived the whole suite by reversing it, since the only prior order assertion sorted
  // its own actuals before comparing.
  it('orders matches alphabetically by name when no location is known, not by fetch/array order', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      makeTakeoff({ takeoffId: 1, name: 'Zeta' }),
      makeTakeoff({ takeoffId: 2, name: 'Alpha' }),
      makeTakeoff({ takeoffId: 3, name: 'Mike' }),
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
    const takeoffs = [...haystack, makeTakeoff({ takeoffId: 999_999, name: 'UniqueMatch' })]

    const result = select(takeoffs, 'uniquematch', 'all')

    expect(result.totalMatchCount).toBe(1)
    expect(result.isTruncated).toBe(false)
    expect(result.matches).toHaveLength(1)
  })

  // Pins WHICH rows survive truncation, not just how many — a prior version of this suite
  // only ever asserted `matches` had the right LENGTH, which passes even for an arbitrary
  // 200-row subset. Names are zero-padded so alphabetical order and numeric order coincide,
  // which lets `expectedNames` be derived straight from the naming scheme instead of by
  // sorting `result.matches` itself — deriving the expectation from the actual output would
  // pass even if selectVisibleTakeoffs returned the right SET of rows in the wrong order, or
  // the wrong set shaped to look right once re-sorted.
  it('keeps the alphabetically-first MAX_RENDERED_RESULTS rows when truncated, not an arbitrary subset', () => {
    const sortableName = (i: number) => `Site${String(i).padStart(4, '0')}`
    const takeoffs: TakeoffDirectoryEntry[] = Array.from({ length: MAX_RENDERED_RESULTS + 37 }, (_, i) =>
      makeTakeoff({ takeoffId: i, name: sortableName(i) }),
    )

    const result = select(takeoffs, '', 'all')

    const expectedNames = Array.from({ length: MAX_RENDERED_RESULTS }, (_, i) => sortableName(i))
    expect(result.matches.map((takeoff) => takeoff.name)).toEqual(expectedNames)
    expect(result.matches.map((takeoff) => takeoff.name)).not.toContain(sortableName(MAX_RENDERED_RESULTS))
  })

  it('every match carries distanceMetres: null when no location is known', () => {
    const takeoffs = [makeTakeoff({ takeoffId: 1, name: 'Alpha' })]

    const result = select(takeoffs, '', 'all')

    expect(result.matches[0].distanceMetres).toBeNull()
  })
})

describe('selectVisibleTakeoffs — wind filter', () => {
  // A fixture that mixes all three shapes wind can take (a real single-bit direction, the
  // all-eight value, and no data at all) — a fixture where every site shares one of these
  // could not express the filter, per #12's own warning about fixtures too tame to catch a
  // regression.
  function windFixture(): TakeoffDirectoryEntry[] {
    return [
      makeTakeoff({ takeoffId: 1, name: 'FacesNorth', wind: 128 }), // N only
      makeTakeoff({ takeoffId: 2, name: 'FacesSouth', wind: 8 }), // S only
      makeTakeoff({ takeoffId: 3, name: 'FacesEverywhere', wind: 255 }), // all eight
      makeTakeoff({ takeoffId: 4, name: 'FacesUnknown', wind: 0 }), // none recorded
    ]
  }

  it('includes a site whose recorded wind covers the requested direction', () => {
    const result = select(windFixture(), '', 'all', 'N')

    expect(result.matches.map((t) => t.takeoffId)).toContain(1)
  })

  // The direct guard against an inverted filter: a site recording ONLY the opposite direction
  // must be excluded, not included, when N is requested.
  it('excludes a site whose recorded wind does not cover the requested direction', () => {
    const result = select(windFixture(), '', 'all', 'N')

    expect(result.matches.map((t) => t.takeoffId)).not.toContain(2)
  })

  it('a site recording all eight directions matches every wind query — not special cased, just correct', () => {
    const result = select(windFixture(), '', 'all', 'N')

    expect(result.matches.map((t) => t.takeoffId)).toContain(3)
  })

  it('excludes a site with no recorded wind from a real direction query', () => {
    const result = select(windFixture(), '', 'all', 'N')

    expect(result.matches.map((t) => t.takeoffId)).not.toContain(4)
  })

  it('a wind filter of "all" includes sites regardless of their recorded wind, including unknown', () => {
    const result = select(windFixture(), '', 'all', 'all')

    expect(result.matches.map((t) => t.takeoffId).sort()).toEqual([1, 2, 3, 4])
  })

  it('reports windUnknownCount for sites excluded specifically for lacking recorded wind', () => {
    const result = select(windFixture(), '', 'all', 'N')

    // Only takeoff 4 (wind=0) is unknown; takeoff 2 is excluded too, but for a real, recorded
    // reason (it faces S, not N) — windUnknownCount must not conflate the two.
    expect(result.windUnknownCount).toBe(1)
  })

  it('windUnknownCount is 0 when the wind filter is "all", since nothing is excluded on wind grounds', () => {
    const result = select(windFixture(), '', 'all', 'all')

    expect(result.windUnknownCount).toBe(0)
  })

  it('windUnknownCount only counts sites that already passed the name and region filters', () => {
    const takeoffs = [
      makeTakeoff({ takeoffId: 1, name: 'InRegion', regionId: 1, wind: 0 }),
      makeTakeoff({ takeoffId: 2, name: 'OutOfRegion', regionId: 2, wind: 0 }),
    ]

    const result = select(takeoffs, '', 1, 'N')

    expect(result.windUnknownCount).toBe(1)
  })

  // The composition guard the issue calls out by name: applying a wind filter must not widen
  // the result back out past the active region filter.
  it('composes with the region filter — wind narrows within the active region, not across all regions', () => {
    const takeoffs = [
      makeTakeoff({ takeoffId: 1, name: 'InRegionFacesNorth', regionId: 1, wind: 128 }),
      makeTakeoff({ takeoffId: 2, name: 'OtherRegionFacesNorth', regionId: 2, wind: 128 }),
    ]

    const result = select(takeoffs, '', 1, 'N')

    expect(result.matches.map((t) => t.takeoffId)).toEqual([1])
  })

  it('composes with the name search — wind narrows within the active query', () => {
    const takeoffs = [
      makeTakeoff({ takeoffId: 1, name: 'Alpha', wind: 128 }),
      makeTakeoff({ takeoffId: 2, name: 'Beta', wind: 128 }),
    ]

    const result = select(takeoffs, 'alpha', 'all', 'N')

    expect(result.matches.map((t) => t.takeoffId)).toEqual([1])
  })
})

describe('selectVisibleTakeoffs — nearby (distance) sort', () => {
  // Real, spread-out coordinates (roughly Bergen, Oslo, and Tromsø), not points close enough
  // that floating-point noise could accidentally order them correctly regardless of whether
  // the distance calculation does anything real.
  function distanceFixture(): TakeoffDirectoryEntry[] {
    return [
      makeTakeoff({ takeoffId: 1, name: 'Bergen', lat: 60.39, lon: 5.32 }),
      makeTakeoff({ takeoffId: 2, name: 'Oslo', lat: 59.91, lon: 10.75 }),
      makeTakeoff({ takeoffId: 3, name: 'Tromso', lat: 69.65, lon: 18.96 }),
    ]
  }

  // From a point essentially at Bergen: Bergen nearest, then Oslo, then Tromsø — pinned as an
  // exact expected order, not derived by sorting the actual result.
  it('sorts nearest-first from the user location', () => {
    const result = select(distanceFixture(), '', 'all', 'all', { lat: 60.39, lon: 5.33 })

    expect(result.matches.map((t) => t.takeoffId)).toEqual([1, 2, 3])
  })

  // Guards against the sort direction being silently flipped (ascending mistaken for
  // descending), which the nearest-first assertion alone could pass "by symmetry" only if the
  // fixture had exactly two points — this one has three, so a reversal changes the WHOLE order,
  // not just swaps two entries.
  it('is genuinely ascending, not descending — from a point near Tromsø, order reverses entirely', () => {
    const result = select(distanceFixture(), '', 'all', 'all', { lat: 69.65, lon: 18.95 })

    expect(result.matches.map((t) => t.takeoffId)).toEqual([3, 2, 1])
  })

  it('attaches a real, non-constant distanceMetres per match, not a placeholder', () => {
    const result = select(distanceFixture(), '', 'all', 'all', { lat: 60.39, lon: 5.33 })
    const distances = new Map(result.matches.map((t) => [t.takeoffId, t.distanceMetres]))

    expect(distances.get(1)).not.toBeNull()
    expect(distances.get(1)!).toBeLessThan(1000) // Bergen, essentially at the user's own position
    expect(distances.get(2)!).toBeGreaterThan(distances.get(1)!)
    expect(distances.get(3)!).toBeGreaterThan(distances.get(2)!)
  })

  it('falls back to alphabetical order when no location is supplied, even though lat/lon data exists', () => {
    const result = select(distanceFixture(), '', 'all', 'all')

    expect(result.matches.map((t) => t.name)).toEqual(['Bergen', 'Oslo', 'Tromso'])
  })

  // The combination #12 calls out as the genuinely useful one: nearby plus wind, together.
  it('composes with the wind filter — nearby sorts within the wind-narrowed set, not the full one', () => {
    const takeoffs = [
      makeTakeoff({ takeoffId: 1, name: 'NearButWrongWind', lat: 60.39, lon: 5.33, wind: 8 }), // S only
      makeTakeoff({ takeoffId: 2, name: 'FarButRightWind', lat: 69.65, lon: 18.96, wind: 128 }), // N only
    ]

    const result = select(takeoffs, '', 'all', 'N', { lat: 60.39, lon: 5.33 })

    expect(result.matches.map((t) => t.takeoffId)).toEqual([2])
  })

  it('a truncated, distance-sorted result still reports the true total, keeping the notice honest', () => {
    const near = makeTakeoffs(MAX_RENDERED_RESULTS + 10, 'Near')
    const takeoffs = near.map((t, i) => ({ ...t, lat: 60 + i * 0.001, lon: 10 }))

    const result = select(takeoffs, '', 'all', 'all', { lat: 60, lon: 10 })

    expect(result.matches).toHaveLength(MAX_RENDERED_RESULTS)
    expect(result.totalMatchCount).toBe(MAX_RENDERED_RESULTS + 10)
    expect(result.isTruncated).toBe(true)
  })

  // D1: flightlog.org's own placeholder for "no coordinates ever recorded" — 0,0 sits in the
  // Gulf of Guinea, thousands of km from anywhere in the real fixture, so a real haversine
  // distance to it is a confident, wrong number, not a rounding error. Real coordinates
  // deliberately avoid 0,0 too, so a mutation that stopped special-casing the placeholder
  // couldn't accidentally pass by coincidence.
  function placeholderCoordTakeoff(takeoffId: number, name: string): TakeoffDirectoryEntry {
    return makeTakeoff({ takeoffId, name, lat: 0, lon: 0 })
  }

  it('never attaches a distance to a takeoff with placeholder (0,0) coordinates', () => {
    const takeoffs = [distanceFixture()[0], placeholderCoordTakeoff(99, 'NoCoords')]

    const result = select(takeoffs, '', 'all', 'all', { lat: 60.39, lon: 5.33 })

    expect(result.matches.find((t) => t.takeoffId === 99)?.distanceMetres).toBeNull()
  })

  it('sorts placeholder-coordinate takeoffs after every located one, regardless of the fabricated Gulf-of-Guinea distance', () => {
    const takeoffs = [placeholderCoordTakeoff(99, 'NoCoords'), ...distanceFixture()]

    const result = select(takeoffs, '', 'all', 'all', { lat: 69.65, lon: 18.95 }) // near Tromsø

    // From near Tromsø the real order is Tromso, Oslo, Bergen (see the "genuinely ascending"
    // test above) — the placeholder must land after all three, not interleaved by a distance
    // that was never real.
    expect(result.matches.map((t) => t.takeoffId)).toEqual([3, 2, 1, 99])
  })

  it('orders multiple placeholder-coordinate takeoffs alphabetically among themselves, not by fetch order', () => {
    const takeoffs = [placeholderCoordTakeoff(2, 'Zulu'), placeholderCoordTakeoff(1, 'Alpha')]

    const result = select(takeoffs, '', 'all', 'all', { lat: 60.39, lon: 5.33 })

    expect(result.matches.map((t) => t.name)).toEqual(['Alpha', 'Zulu'])
  })

  it('counts matching takeoffs with no known location via locationUnknownCount', () => {
    const takeoffs = [distanceFixture()[0], placeholderCoordTakeoff(99, 'NoCoords'), placeholderCoordTakeoff(98, 'AlsoNoCoords')]

    const result = select(takeoffs, '', 'all', 'all', { lat: 60.39, lon: 5.33 })

    expect(result.locationUnknownCount).toBe(2)
  })

  it('locationUnknownCount is 0 when no user location is supplied, since nothing is being sorted by distance', () => {
    const takeoffs = [placeholderCoordTakeoff(99, 'NoCoords')]

    const result = select(takeoffs, '', 'all', 'all')

    expect(result.locationUnknownCount).toBe(0)
  })

  it('locationUnknownCount only counts takeoffs that already passed the wind filter', () => {
    const takeoffs = [
      makeTakeoff({ takeoffId: 1, name: 'WrongWindNoCoords', lat: 0, lon: 0, wind: 8 }), // S only, excluded by wind
      makeTakeoff({ takeoffId: 2, name: 'RightWindNoCoords', lat: 0, lon: 0, wind: 128 }), // N only, survives
    ]

    const result = select(takeoffs, '', 'all', 'N', { lat: 60.39, lon: 5.33 })

    expect(result.locationUnknownCount).toBe(1)
  })

  // D1: the full lat=0/lon=0 placeholder isn't the only corrupt shape in the live dataset —
  // hasKnownLocation also catches a single axis dropped to 0 (takeoff 8478 "Veines
  // (Kongsfjord)" really carries lat=0, lon=70.73: its real latitude landed in the longitude
  // column) and both axes corrupted to a small non-zero remainder near Null Island (takeoff
  // 10778 "Auenhaugen, Golsfjellet": lat=-1.02, lon=1.02). Both shapes would otherwise report
  // a confident, fabricated distance here, exactly like the 0,0 case above — the same class
  // of bug, through the same shared predicate.
  it('never attaches a distance to a takeoff with only one axis zeroed, or to one corrupted to a small remainder near Null Island', () => {
    const takeoffs = [
      distanceFixture()[0],
      makeTakeoff({ takeoffId: 98, name: 'LatLostToZero', lat: 0, lon: 70.73 }),
      makeTakeoff({ takeoffId: 97, name: 'NearNullIsland', lat: -1.02, lon: 1.02 }),
    ]

    const result = select(takeoffs, '', 'all', 'all', { lat: 60.39, lon: 5.33 })

    expect(result.matches.find((t) => t.takeoffId === 98)?.distanceMetres).toBeNull()
    expect(result.matches.find((t) => t.takeoffId === 97)?.distanceMetres).toBeNull()
  })

  // D1: isTruncated and totalMatchCount must reflect the WIND-narrowed set, the same
  // requirement windUnknownCount's own composition tests already pin for the count alone —
  // here the set starts well over the cap, and the wind filter alone brings it back under,
  // so a mutation that computed either figure from the pre-wind set (instead of windMatched)
  // would report truncation, or a total, that no longer matches what's actually rendered.
  it('isTruncated and totalMatchCount reflect the wind-narrowed set, not the pre-wind one', () => {
    const facingNorth = Array.from({ length: 5 }, (_, i) => makeTakeoff({ takeoffId: i, name: `North${i}`, wind: 128 }))
    const facingSouth = Array.from({ length: MAX_RENDERED_RESULTS + 20 }, (_, i) =>
      makeTakeoff({ takeoffId: 1000 + i, name: `South${i}`, wind: 8 }),
    )

    const result = select([...facingNorth, ...facingSouth], '', 'all', 'N')

    expect(result.totalMatchCount).toBe(5)
    expect(result.isTruncated).toBe(false)
    expect(result.matches).toHaveLength(5)
  })
})

describe('parseWindFilterParam', () => {
  it.each(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const)('accepts the valid octant %s from a URL query value', (octant) => {
    expect(parseWindFilterParam(octant)).toBe(octant)
  })

  it('falls back to "all" when the value is undefined (no ?wind= param present)', () => {
    expect(parseWindFilterParam(undefined)).toBe('all')
  })

  it.each(['north', 'n', '', 'NNE', '128', 'null', 'undefined'])(
    'falls back to "all" for an invalid or malformed value %j, rather than throwing',
    (value) => {
      expect(parseWindFilterParam(value)).toBe('all')
    },
  )
})

describe('foldTakeoffNames', () => {
  it('folds every name once, keyed by takeoffId', () => {
    const takeoffs: TakeoffDirectoryEntry[] = [
      makeTakeoff({ takeoffId: 1, name: 'Bodø' }),
      makeTakeoff({ takeoffId: 2, name: 'Ålesund' }),
    ]

    const folded = foldTakeoffNames(takeoffs)

    expect(folded.get(1)).toBe('bodo')
    expect(folded.get(2)).toBe('alesund')
  })
})

describe('withUnregionedOptions', () => {
  it('adds no synthetic option when every takeoff has a known region', () => {
    const regions: RegionOption[] = [{ regionId: 1, name: 'Østlandet' }]
    const takeoffs: TakeoffDirectoryEntry[] = [makeTakeoff({ takeoffId: 1, name: 'Alpha', regionId: 1 })]

    expect(withUnregionedOptions(regions, takeoffs)).toEqual(regions)
  })

  // Pins the actual defect: flightlog.org's own regionId 0 convention (no matching entry in
  // the fetched region list) must become a real, selectable dropdown entry, not a silent gap
  // only reachable through "All regions."
  it('adds a synthetic UNREGIONED_LABEL option for a regionId absent from the fetched regions', () => {
    const regions: RegionOption[] = [{ regionId: 1, name: 'Østlandet' }]
    const takeoffs: TakeoffDirectoryEntry[] = [
      makeTakeoff({ takeoffId: 1, name: 'Alpha', regionId: 1 }),
      makeTakeoff({ takeoffId: 2, name: 'Orphan', regionId: 0 }),
    ]

    expect(withUnregionedOptions(regions, takeoffs)).toEqual([
      { regionId: 1, name: 'Østlandet' },
      { regionId: 0, name: UNREGIONED_LABEL },
    ])
  })

  it('adds exactly one synthetic option per distinct orphan regionId, not one per orphaned takeoff', () => {
    const regions: RegionOption[] = []
    const takeoffs: TakeoffDirectoryEntry[] = [
      makeTakeoff({ takeoffId: 1, name: 'A', regionId: 0 }),
      makeTakeoff({ takeoffId: 2, name: 'B', regionId: 0 }),
      makeTakeoff({ takeoffId: 3, name: 'C', regionId: 0 }),
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
