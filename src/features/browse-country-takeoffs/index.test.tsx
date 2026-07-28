import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import TakeoffDirectory, { resolveUserLocation } from './index'
import { MAX_RENDERED_RESULTS, type RegionOption } from './select-visible-takeoffs'
import * as selectVisibleTakeoffsModule from './select-visible-takeoffs'
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'

// The real TakeoffsMap constructs an actual maplibre-gl MapLibreMap against a canvas — jsdom
// has no WebGL context, the same reason track-map.tsx has no unit test of its own (see
// scripts/verify-*.mts instead). Stubbed here so this suite can assert the SWITCH into map
// view and what it's handed, without needing a real GL context; the map's own rendering is
// covered by scripts/verify-sites-map.mts against a live browser instead.
vi.mock('./takeoffs-map', () => ({
  TakeoffsMap: ({ takeoffs }: { takeoffs: TakeoffDirectoryEntry[] }) => (
    <div data-testid="stub-takeoffs-map">{takeoffs.length} sites on the map</div>
  ),
}))

// Stubs the real network boundary (global fetch), not the hook — mocking the hook would let a
// default export that never calls it, and instead returns a hardcoded state, pass this suite
// unnoticed. Same reasoning #38's review already established for this component's ancestor.
function stubFetch(rows: unknown[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(rows),
    }),
  )
}

// Builds a wire-shaped TakeoffRow tuple (see contract.ts's own field order) with realistic
// in-range lat/lon/wind, so isTakeoffRows accepts it — takeoffId, name and regionId (indices
// 0, 1, 6) are the fields most tests vary; lat/lon/wind (indices 2, 3, 4) default to a fixed,
// unremarkable point with no recorded wind, and are overridden explicitly by the tests below
// that exercise #12's filters.
function makeRow(
  takeoffId: number,
  name: string,
  regionId: number,
  options?: { wind?: number; lat?: number; lon?: number },
): unknown[] {
  return [takeoffId, name, options?.lat ?? 60, options?.lon ?? 10, options?.wind ?? 0, 999, regionId, 0, 500, 100]
}

const REGIONS: RegionOption[] = [
  { regionId: 1, name: 'Østlandet' },
  { regionId: 2, name: 'Vestlandet' },
]

// jsdom does not implement navigator.geolocation — installed and removed per test that needs
// it, same shape as use-nearby.test.ts's own fakes, so a mid-suite test that forgets to install
// one exercises the real, absent API ('unavailable') rather than silently reusing a leftover
// mock from a previous test.
type FakeGeolocation = { watchPosition: ReturnType<typeof vi.fn>; clearWatch: ReturnType<typeof vi.fn> }
function installFakeGeolocation(behavior: 'granted' | 'denied' | 'timeout' | (() => void)): FakeGeolocation {
  const fake: FakeGeolocation = {
    watchPosition: vi.fn((onSuccess: (p: GeolocationPosition) => void, onError: (e: GeolocationPositionError) => void) => {
      if (behavior === 'granted') onSuccess({ coords: { latitude: 60.0, longitude: 10.0 } } as GeolocationPosition)
      else if (behavior === 'denied')
        onError({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
      else if (behavior === 'timeout')
        onError({ code: 3, message: 'timeout', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
      else behavior()
      return 1
    }),
    clearWatch: vi.fn(),
  }
  // Installs the SAME object it returns, not a copy with an extra field spliced in — a caller
  // that asserts against the returned value (e.g. on clearWatch) is asserting against what the
  // component actually called, not a look-alike.
  Object.defineProperty(window.navigator, 'geolocation', {
    value: fake,
    configurable: true,
    writable: true,
  })
  return fake
}

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(window.navigator, 'geolocation', { value: undefined, configurable: true, writable: true })
  window.history.replaceState(null, '', '/')
})

describe('resolveUserLocation', () => {
  // Mutation: dropping the `nearbyEnabled` half of this check, so a stale 'granted' status
  // (which handleNearbyToggle's own stopNearby call is what normally clears — see
  // use-nearby.test.ts's own stopNearby coverage) keeps applying distance sort even after the
  // user unchecked the box. Tested directly, independent of stopNearby, so this stays pinned
  // even if the reset path it usually relies on changes shape.
  it('is null when nearby is disabled, even though status is "granted" and a location is known', () => {
    expect(resolveUserLocation(false, 'granted', { lat: 60, lon: 10 })).toBeNull()
  })

  it('is the real location when nearby is enabled and status is "granted"', () => {
    expect(resolveUserLocation(true, 'granted', { lat: 60, lon: 10 })).toEqual({ lat: 60, lon: 10 })
  })

  it.each(['idle', 'pending', 'denied', 'unavailable', 'timeout'] as const)(
    'is null while enabled but status is "%s", not yet a real location',
    (status) => {
      expect(resolveUserLocation(true, status, { lat: 60, lon: 10 })).toBeNull()
    },
  )
})

describe('TakeoffDirectory — input-driven filtering', () => {
  it('narrows the rendered rows as the user types, folding Norwegian characters along the way', async () => {
    stubFetch([makeRow(1, 'Bodø', 1), makeRow(2, 'Ålesund', 2), makeRow(3, 'Oslo', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)

    await screen.findByText('Bodø')
    screen.getByText('Ålesund')
    screen.getByText('Oslo')

    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'bodo' } })

    await waitFor(() => expect(screen.queryByText('Oslo')).toBeNull())
    screen.getByText('Bodø')
    expect(screen.queryByText('Ålesund')).toBeNull()
  })

  it("finds the issue's own worked example live, through the real rendered component", async () => {
    stubFetch([makeRow(1, 'Vågå', 1), makeRow(2, 'Unrelated', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Vågå')

    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'Vagaa' } })

    await waitFor(() => expect(screen.queryByText('Unrelated')).toBeNull())
    screen.getByText('Vågå')
  })

  it('filters by the selected region and displays the region NAME on each row, not its bare id', async () => {
    stubFetch([makeRow(1, 'Alpha', 1), makeRow(2, 'Beta', 2)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')
    const list = screen.getByRole('list')
    within(list).getByText('Østlandet')
    within(list).getByText('Vestlandet')

    fireEvent.change(screen.getByRole('combobox', { name: /region/i }), { target: { value: '2' } })

    await waitFor(() => expect(within(list).queryByText('Alpha')).toBeNull())
    within(list).getByText('Beta')
    within(list).getByText('Vestlandet')
    expect(within(list).queryByText('Østlandet')).toBeNull()
  })

  it('caps the rendered rows and shows a visible truncation notice, which disappears once the match set narrows under the cap', async () => {
    const rows = Array.from({ length: MAX_RENDERED_RESULTS + 50 }, (_, i) => makeRow(i, `Site${i}`, 1))
    rows.push(makeRow(999_999, 'UniqueOnly', 2))
    stubFetch(rows)

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)

    await screen.findByText(new RegExp(`Showing ${MAX_RENDERED_RESULTS} of ${MAX_RENDERED_RESULTS + 51} matches`))
    // The notice text alone isn't proof the DOM itself is capped — it's derived from the same
    // totalMatchCount either way. Counting actual rendered <li> rows is what catches a cap
    // that silently stopped applying to `matches` while `isTruncated`'s arithmetic (and so the
    // notice text) kept computing correctly regardless.
    expect(screen.getAllByRole('listitem')).toHaveLength(MAX_RENDERED_RESULTS)

    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'uniqueonly' } })

    await screen.findByText('UniqueOnly')
    expect(screen.queryByText(/showing \d+ of \d+ matches/i)).toBeNull()
  })

  it('shows the loading state before the fetch resolves', () => {
    stubFetch([])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)

    screen.getByText(/loading takeoffs/i)
  })

  it('shows the server-provided error message verbatim on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({ error: 'boom' }) }),
    )

    render(<TakeoffDirectory countryId={160} countryName="Norway" regions={REGIONS} />)

    await screen.findByText('takeoffs for country 160: server returned 502')
  })

  it('shows a distinct empty state for a real zero-match search, not the loading or error state', async () => {
    stubFetch([makeRow(1, 'Bodø', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Bodø')

    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'zzznomatchxyz' } })

    await screen.findByText(/no takeoffs match/i)
  })

  it('renders the real fetched takeoff count in the header, not a hardcoded one', async () => {
    stubFetch([makeRow(1, 'Bodø', 1), makeRow(2, 'Ålesund', 2), makeRow(3, 'Oslo', 1), makeRow(4, 'Vågå', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)

    await screen.findByText('4 takeoffs')
  })

  // flightlog.org's own regionId 0 convention: a takeoff whose region was never registered,
  // 10.4% of Norway's real fixture — the literal `Region 0` string previously rendered here
  // claimed a region existed under that number when none does.
  it('labels a takeoff whose regionId has no matching region as "Unregioned", not the bare id', async () => {
    stubFetch([makeRow(1, 'Alpha', 1), makeRow(2, 'Orphan', 0)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Orphan')

    const list = screen.getByRole('list')
    within(list).getByText('Unregioned')
    expect(within(list).queryByText('Region 0')).toBeNull()
  })

  it('adds a selectable "Unregioned" entry to the region dropdown when an orphan regionId is present, and filtering by it works', async () => {
    stubFetch([makeRow(1, 'Alpha', 1), makeRow(2, 'Orphan', 0)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')

    const regionSelect = screen.getByRole('combobox', { name: /region/i })
    within(regionSelect).getByText('Unregioned')

    fireEvent.change(regionSelect, { target: { value: '0' } })

    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull())
    screen.getByText('Orphan')
  })

  it('does not add an "Unregioned" entry when every takeoff has a known region', async () => {
    stubFetch([makeRow(1, 'Alpha', 1), makeRow(2, 'Beta', 2)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')

    expect(screen.queryByText('Unregioned')).toBeNull()
  })

  it('orders the region dropdown alphabetically by name', async () => {
    stubFetch([makeRow(1, 'Alpha', 1), makeRow(2, 'Beta', 2)])
    const unsortedRegions: RegionOption[] = [
      { regionId: 1, name: 'Østlandet' },
      { regionId: 2, name: 'Agder' },
    ]

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={unsortedRegions} />)
    await screen.findByText('Alpha')

    const options = within(screen.getByRole('combobox', { name: /region/i })).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['All regions', 'Agder', 'Østlandet'])
  })

  it('blames the actual cause, not an untyped query, when a selected region has zero takeoffs', async () => {
    stubFetch([makeRow(1, 'Alpha', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')

    fireEvent.change(screen.getByRole('combobox', { name: /region/i }), { target: { value: '2' } })

    await screen.findByText('No takeoffs recorded in Vestlandet.')
    expect(screen.queryByText(/no takeoffs match/i)).toBeNull()
  })
})

describe('TakeoffDirectory — wind filter', () => {
  it('choosing a direction narrows the rendered set to sites recorded to work in it', async () => {
    stubFetch([makeRow(1, 'FacesNorth', 1, { wind: 128 }), makeRow(2, 'FacesSouth', 1, { wind: 8 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('FacesNorth')
    screen.getByText('FacesSouth')

    fireEvent.change(screen.getByRole('combobox', { name: /wind direction/i }), { target: { value: 'N' } })

    await waitFor(() => expect(screen.queryByText('FacesSouth')).toBeNull())
    screen.getByText('FacesNorth')
  })

  it('excludes a site with no recorded wind and surfaces the exclusion, not silently', async () => {
    stubFetch([makeRow(1, 'FacesNorth', 1, { wind: 128 }), makeRow(2, 'NoWindRecorded', 1, { wind: 0 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('NoWindRecorded')

    fireEvent.change(screen.getByRole('combobox', { name: /wind direction/i }), { target: { value: 'N' } })

    await waitFor(() => expect(screen.queryByText('NoWindRecorded')).toBeNull())
    await screen.findByText(/1 otherwise-matching site has no recorded wind and is excluded/i)
  })

  it('shows no exclusion notice while the wind filter is "Any wind", even though unknown-wind sites are present', async () => {
    stubFetch([makeRow(1, 'FacesNorth', 1, { wind: 128 }), makeRow(2, 'NoWindRecorded', 1, { wind: 0 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('NoWindRecorded')

    expect(screen.queryByText(/no recorded wind direction/i)).toBeNull()
  })

  it('composes with the region filter — wind narrows within the active region, not across all regions', async () => {
    stubFetch([
      makeRow(1, 'InRegionFacesNorth', 1, { wind: 128 }),
      makeRow(2, 'OtherRegionFacesNorth', 2, { wind: 128 }),
    ])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('InRegionFacesNorth')

    fireEvent.change(screen.getByRole('combobox', { name: /region/i }), { target: { value: '1' } })
    fireEvent.change(screen.getByRole('combobox', { name: /wind direction/i }), { target: { value: 'N' } })

    await waitFor(() => expect(screen.queryByText('OtherRegionFacesNorth')).toBeNull())
    screen.getByText('InRegionFacesNorth')
  })

  // B1: the empty state must name BOTH active causes, not just the first one picked out of
  // a chain — a region with hundreds of sites reads as genuinely empty otherwise, when the
  // real reason is the wind filter narrowing it to zero within that region.
  it('names both the region and the wind direction when their combination has zero results', async () => {
    stubFetch([makeRow(1, 'AlphaFacesSouth', 1, { wind: 8 }), makeRow(2, 'BetaFacesNorth', 2, { wind: 128 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('AlphaFacesSouth')

    fireEvent.change(screen.getByRole('combobox', { name: /region/i }), { target: { value: '2' } })
    fireEvent.change(screen.getByRole('combobox', { name: /wind direction/i }), { target: { value: 'S' } })

    await screen.findByText('No takeoffs recorded in Vestlandet that work in S.')
  })

  // Same bug, the other pairing: a name query composed with a wind filter must also name
  // both causes, not silently drop the wind half of the story.
  it('names both the query and the wind direction when their combination has zero results', async () => {
    stubFetch([makeRow(1, 'Alpha', 1, { wind: 8 }), makeRow(2, 'Beta', 1, { wind: 128 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')

    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'Alpha' } })
    fireEvent.change(screen.getByRole('combobox', { name: /wind direction/i }), { target: { value: 'N' } })

    await screen.findByText('No takeoffs match “Alpha” that work in N.')
  })

  // A shared link (?wind=S) opens straight into the filtered view — the whole point of
  // carrying this filter in the URL (see index.tsx's own readWindFilterFromUrl doc comment).
  // Seeded via the real address bar, not a prop: this component now reads `?wind=` itself,
  // client-side, specifically so the page it lives on never needs a searchParams-dependent
  // Suspense boundary just to seed one select's default (see page.tsx's own comment on that).
  it('seeds the wind select and the rendered set from the URL’s ?wind= param', async () => {
    window.history.replaceState(null, '', '/?wind=S')
    stubFetch([makeRow(1, 'FacesNorth', 1, { wind: 128 }), makeRow(2, 'FacesSouth', 1, { wind: 8 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)

    await screen.findByText('FacesSouth')
    expect(screen.queryByText('FacesNorth')).toBeNull()
    expect((screen.getByRole('combobox', { name: /wind direction/i }) as HTMLSelectElement).value).toBe('S')
  })

  it('falls back to "Any wind" for an invalid ?wind= param, rather than passing the raw string through', async () => {
    window.history.replaceState(null, '', '/?wind=northwest')
    stubFetch([makeRow(1, 'FacesNorth', 1, { wind: 128 }), makeRow(2, 'FacesSouth', 1, { wind: 8 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)

    await screen.findByText('FacesNorth')
    screen.getByText('FacesSouth')
    expect((screen.getByRole('combobox', { name: /wind direction/i }) as HTMLSelectElement).value).toBe('all')
  })

  it('updates the URL as the wind filter changes, and clears the param back to "Any wind"', async () => {
    stubFetch([makeRow(1, 'FacesNorth', 1, { wind: 128 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('FacesNorth')

    fireEvent.change(screen.getByRole('combobox', { name: /wind direction/i }), { target: { value: 'N' } })
    expect(window.location.search).toBe('?wind=N')

    fireEvent.change(screen.getByRole('combobox', { name: /wind direction/i }), { target: { value: 'all' } })
    expect(window.location.search).toBe('')
  })

  // D4: the select falling back to "Any wind" for an invalid param (pinned above) is only
  // half the fix — the address bar must stop claiming a filter that was never actually
  // applied, otherwise re-sharing the link propagates the same invalid `?wind=` forever.
  it('corrects an invalid ?wind= param out of the address bar on mount, not just out of the select', async () => {
    window.history.replaceState(null, '', '/?wind=northwest')
    stubFetch([makeRow(1, 'FacesNorth', 1, { wind: 128 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('FacesNorth')

    expect(window.location.search).toBe('')
  })

  // Sibling case: a mount-time sync that ALWAYS wrote the wind param (rather than only
  // correcting an invalid one) would strip a legitimate, already-correct link right back
  // down — pin that a valid param survives mount untouched.
  it('leaves a valid ?wind= param in the address bar untouched on mount', async () => {
    window.history.replaceState(null, '', '/?wind=N')
    stubFetch([makeRow(1, 'FacesNorth', 1, { wind: 128 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('FacesNorth')

    expect(window.location.search).toBe('?wind=N')
  })

  // Mutation: the whole empty-state wind exclusion clause deleted. Nothing above exercises
  // the EMPTY state's own copy of this notice — only the non-empty list view's — so a
  // regression here would previously have rendered a bare "No takeoffs match…" with no
  // mention of the sites the wind filter silently dropped.
  it('surfaces the wind exclusion notice on the EMPTY state too, not only the populated list', async () => {
    stubFetch([makeRow(1, 'NoWindRecorded', 1, { wind: 0 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('NoWindRecorded')

    fireEvent.change(screen.getByRole('combobox', { name: /wind direction/i }), { target: { value: 'N' } })

    await screen.findByText(/No takeoffs recorded that work in N\./)
    screen.getByText(/1 otherwise-matching site has no recorded wind and is excluded/i)
  })
})

describe('TakeoffDirectory — nearby', () => {
  it('sorts nearest-first once permission is granted and "Nearby" is checked', async () => {
    installFakeGeolocation('granted') // resolves to lat: 60.0, lon: 10.0
    stubFetch([
      makeRow(1, 'FarSite', 1, { lat: 69.65, lon: 18.96 }),
      makeRow(2, 'NearSite', 1, { lat: 60.0, lon: 10.0 }),
    ])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('FarSite')

    fireEvent.click(screen.getByRole('checkbox', { name: /sort by distance/i }))

    await waitFor(() => {
      const names = screen.getAllByRole('listitem').map((li) => li.textContent)
      expect(names[0]).toContain('NearSite')
      expect(names[1]).toContain('FarSite')
    })
  })

  // The hard requirement: refusal is a normal path, not an error — the list must stay exactly
  // as usable as before the checkbox was ever touched.
  it('a denied permission keeps the list usable (no error state) and explains why distance sort is off', async () => {
    installFakeGeolocation('denied')
    stubFetch([makeRow(1, 'Alpha', 1), makeRow(2, 'Beta', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByRole('checkbox', { name: /sort by distance/i }))

    await screen.findByText(/location permission denied/i)
    screen.getByText('Alpha')
    screen.getByText('Beta')
    expect(screen.queryByText(/error/i)).toBeNull()
  })

  it('an unavailable geolocation API (no navigator.geolocation at all) also keeps the list usable', async () => {
    stubFetch([makeRow(1, 'Alpha', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByRole('checkbox', { name: /sort by distance/i }))

    await screen.findByText(/location unavailable in this browser/i)
    screen.getByText('Alpha')
  })

  // #12's own "genuinely useful" combination: nearby sorts within whatever the wind filter
  // already narrowed down to, rather than either filter ignoring the other.
  it('composes with the wind filter — nearby sorts within the wind-narrowed set', async () => {
    installFakeGeolocation('granted') // resolves to lat: 60.0, lon: 10.0
    stubFetch([
      makeRow(1, 'NearButWrongWind', 1, { lat: 60.0, lon: 10.0, wind: 8 }), // S only
      makeRow(2, 'FarButRightWind', 1, { lat: 69.65, lon: 18.96, wind: 128 }), // N only
    ])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('NearButWrongWind')

    fireEvent.change(screen.getByRole('combobox', { name: /wind direction/i }), { target: { value: 'N' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /sort by distance/i }))

    await waitFor(() => expect(screen.queryByText('NearButWrongWind')).toBeNull())
    screen.getByText('FarButRightWind')
  })

  // Mutation: formatDistanceKm dividing by 100 instead of 1000, rendering every distance ten
  // times too large. One degree of latitude along a meridian is R * (π/180) metres exactly
  // (same closed form distance.test.ts pins independently), which for lon held fixed at 10
  // works out to 111.2 km regardless of which latitude it's measured from — a real,
  // independently-computable figure, not derived by calling the code under test.
  it('renders the real distance in km, to one decimal place, not a scaled or truncated figure', async () => {
    installFakeGeolocation('granted') // resolves to lat: 60.0, lon: 10.0
    stubFetch([makeRow(1, 'OneDegreeNorth', 1, { lat: 61.0, lon: 10.0 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('OneDegreeNorth')

    fireEvent.click(screen.getByRole('checkbox', { name: /sort by distance/i }))

    await screen.findByText('111.2 km')
  })

  // D1: the nearby filter must never invent a distance for a takeoff with no recorded
  // position (lat=0/lon=0 — see hasKnownLocation in select-visible-takeoffs.ts). Also pins
  // the `distanceMetres !== null` render guard: dropping it would attempt to format a null
  // distance instead of omitting the figure entirely.
  it('shows no distance for a takeoff with no recorded location, and surfaces how many were affected', async () => {
    installFakeGeolocation('granted') // resolves to lat: 60.0, lon: 10.0
    stubFetch([makeRow(1, 'HasCoords', 1, { lat: 61.0, lon: 10.0 }), makeRow(2, 'NoCoords', 1, { lat: 0, lon: 0 })])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('HasCoords')

    fireEvent.click(screen.getByRole('checkbox', { name: /sort by distance/i }))

    await screen.findByText('111.2 km')
    const noCoordsRow = screen.getByText('NoCoords').closest('li')
    expect(noCoordsRow).not.toBeNull()
    expect(within(noCoordsRow!).queryByText(/km/)).toBeNull()
    await screen.findByText(/1 matching site has no recorded location and is shown without a distance/i)
  })

  // D2: unchecking must actually stop the watch (see use-nearby.test.ts's own stopNearby
  // coverage for the hook-level guarantee) — this is the component-level proof that the
  // checkbox is actually wired to it, and that distance sort itself stops applying, closing
  // both the leaked-watch bug and the "userLocation ignores the enabled flag" mutation in one
  // observable behaviour.
  it('unchecking nearby stops the watch and falls back to alphabetical order with no distances shown', async () => {
    const fake = installFakeGeolocation('granted') // resolves to lat: 60.0, lon: 10.0
    stubFetch([
      makeRow(1, 'FarSite', 1, { lat: 69.65, lon: 18.96 }),
      makeRow(2, 'NearSite', 1, { lat: 60.0, lon: 10.0 }),
    ])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('FarSite')
    fireEvent.click(screen.getByRole('checkbox', { name: /sort by distance/i }))
    await waitFor(() => {
      const names = screen.getAllByRole('listitem').map((li) => li.textContent)
      expect(names[0]).toContain('NearSite')
    })

    fireEvent.click(screen.getByRole('checkbox', { name: /sort by distance/i }))

    expect(fake.clearWatch).toHaveBeenCalledWith(1)
    await waitFor(() => {
      const names = screen.getAllByRole('listitem').map((li) => li.textContent)
      expect(names[0]).toContain('FarSite') // alphabetical once more
    })
    expect(screen.queryByText(/km/)).toBeNull()
  })

  // D3: a timeout is a real, distinct outcome — not the same claim as "unavailable in this
  // browser" — and the user must be able to retry rather than being stuck on a status that
  // never changes again.
  it('reports a timeout distinctly from "unavailable", and a re-check retries the request', async () => {
    installFakeGeolocation('timeout')
    stubFetch([makeRow(1, 'Alpha', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByRole('checkbox', { name: /sort by distance/i }))
    await screen.findByText(/timed out/i)
    expect(screen.queryByText(/location unavailable in this browser/i)).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: /sort by distance/i })) // uncheck
    const fake = installFakeGeolocation('granted') // swap in a browser that now answers
    fireEvent.click(screen.getByRole('checkbox', { name: /sort by distance/i })) // re-check

    await waitFor(() => expect(fake.watchPosition).toHaveBeenCalledTimes(1))
  })

  // Mutation: undoing #9's memoised fold (see foldTakeoffNames' own doc comment for the
  // measured ~8.3ms cost over 6012 real names) makes it re-run on every keystroke instead of
  // once per fetched dataset. Spying on the exported function directly, rather than timing
  // the suite, is what makes this assertion exact rather than a flaky duration threshold.
  it('folds every takeoff name once per fetched dataset, not once per keystroke', async () => {
    const foldSpy = vi.spyOn(selectVisibleTakeoffsModule, 'foldTakeoffNames')
    stubFetch([makeRow(1, 'Alpha', 1), makeRow(2, 'Beta', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')
    const callsAfterMount = foldSpy.mock.calls.length
    expect(callsAfterMount).toBeGreaterThan(0)

    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'a' } })
    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'al' } })
    fireEvent.change(screen.getByRole('textbox', { name: /takeoff name/i }), { target: { value: 'alp' } })
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())

    expect(foldSpy.mock.calls.length).toBe(callsAfterMount)
    foldSpy.mockRestore()
  })
})

describe('TakeoffDirectory — #10 map view toggle', () => {
  it('shows the list by default, with no map mounted', async () => {
    stubFetch([makeRow(1, 'Alpha', 1)])

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')

    expect(screen.queryByTestId('stub-takeoffs-map')).toBeNull()
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Map' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('switches to the map view on click, handing it the SAME fetched dataset rather than fetching again', async () => {
    stubFetch([makeRow(1, 'Alpha', 1), makeRow(2, 'Beta', 1)])
    const fetchSpy = vi.mocked(fetch)

    render(<TakeoffDirectory countryId={999} countryName="Norway" regions={REGIONS} />)
    await screen.findByText('Alpha')
    const callsBeforeToggle = fetchSpy.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Map' }))

    await screen.findByTestId('stub-takeoffs-map')
    screen.getByText('2 sites on the map')
    expect(screen.queryByText('Alpha')).toBeNull() // the list itself is no longer rendered
    expect(fetchSpy.mock.calls.length).toBe(callsBeforeToggle) // no second network request

    fireEvent.click(screen.getByRole('button', { name: 'List' }))

    await screen.findByText('Alpha')
    expect(screen.queryByTestId('stub-takeoffs-map')).toBeNull()
  })

  it('shows loading/error states in the map view too, rather than mounting the map on incomplete data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({ error: 'boom' }) }),
    )

    render(<TakeoffDirectory countryId={160} countryName="Norway" regions={REGIONS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Map' }))

    await screen.findByText('takeoffs for country 160: server returned 502')
    expect(screen.queryByTestId('stub-takeoffs-map')).toBeNull()
  })
})
