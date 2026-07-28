import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import TakeoffDirectory from './index'
import { MAX_RENDERED_RESULTS, type RegionOption } from './select-visible-takeoffs'

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
function installFakeGeolocation(behavior: 'granted' | 'denied' | (() => void)): FakeGeolocation {
  const fake: FakeGeolocation = {
    watchPosition: vi.fn((onSuccess: (p: GeolocationPosition) => void, onError: (e: GeolocationPositionError) => void) => {
      if (behavior === 'granted') onSuccess({ coords: { latitude: 60.0, longitude: 10.0 } } as GeolocationPosition)
      else if (behavior === 'denied')
        onError({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
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
    await screen.findByText(/1 matching site has no recorded wind direction and is excluded/i)
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
})
