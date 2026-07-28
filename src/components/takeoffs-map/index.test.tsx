import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MapLibreMap, MapMouseEvent } from 'maplibre-gl'
import { Popup } from 'maplibre-gl'
import { buildSitePopupContent, TakeoffsMapLegend, unclusteredCategoryFilter, wireSitePopups } from './index'
import { UNCLUSTERED_NONE_LAYER_ID } from './site-layer-ids'
import type { TakeoffsMapData } from './build-takeoffs-geojson'

// The real TakeoffsMap mounts an actual maplibre-gl MapLibreMap against a canvas — jsdom has no
// WebGL context. But not everything this file exports needs one: buildSitePopupContent is plain
// DOM, TakeoffsMapLegend is a plain React component that only reads TakeoffsMapData,
// unclusteredCategoryFilter is a pure function building a filter expression, and wireSitePopups
// only needs a fake object shaped like the slice of MapLibreMap it actually calls (`on` and
// `queryRenderedFeatures`) plus a mocked `Popup` — none of that needs a real GL context. The
// browser script (scripts/verify-sites-map.mts) is still what proves the map actually renders
// these, but a green `pnpm run check` should not depend on remembering to run that by hand.

vi.mock('maplibre-gl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('maplibre-gl')>()
  return {
    ...actual,
    // A real `function`, not an arrow — `new Popup()` needs a constructor, and only a
    // `function`-based mock implementation supports `new`.
    Popup: vi.fn().mockImplementation(function PopupMock(this: unknown) {
      Object.assign(this as object, {
        setLngLat: vi.fn().mockReturnThis(),
        setDOMContent: vi.fn().mockReturnThis(),
        addTo: vi.fn().mockReturnThis(),
      })
    }),
  }
})

describe('buildSitePopupContent', () => {
  it('renders the takeoff name and wind summary as visible text', () => {
    const content = buildSitePopupContent('Bergen', 'Works in N, S', '/countries/160/takeoffs/179')

    expect(content.textContent).toContain('Bergen')
    expect(content.textContent).toContain('Works in N, S')
  })

  // #11: the name is now a real link into the takeoff's own detail page — a plain `<a>`, not
  // `next/link` (see this function's own doc comment on why), so the href alone is what proves
  // the link actually goes to the detail route rather than merely rendering the right text.
  it('links the name to the takeoff detail route', () => {
    const content = buildSitePopupContent('Bergen', 'Works in N, S', '/countries/160/takeoffs/179')

    const link = content.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/countries/160/takeoffs/179')
    expect(link?.textContent).toBe('Bergen')
  })

  // #11 fix round: the single-marker map on a takeoff's own detail page must not link the
  // popup right back to the page the visitor is already reading.
  it('renders plain, non-linked text when detailHref is null (the current-page case)', () => {
    const content = buildSitePopupContent('Bergen', 'Works in N, S', null)

    expect(content.querySelector('a')).toBeNull()
    expect(content.textContent).toContain('Bergen')
  })

  // D2: "popup textContent changed to innerHTML" is one of the six mutations that leaves
  // `pnpm run check` green — a takeoff name is upstream flightlog.org content, not something
  // this app controls the shape of, so an innerHTML assignment would turn a scraped name into
  // an injection sink. Asserting the literal markup never parses into a real element (rather
  // than merely checking the visible text, which an innerHTML assignment would also produce
  // correctly for this exact input) is what actually distinguishes textContent from innerHTML.
  it('never parses a takeoff name as markup, even if it contains an HTML-looking string', () => {
    const maliciousName = '<img src=x onerror="window.__pwned = true">'
    const content = buildSitePopupContent(maliciousName, 'No wind direction recorded', '/countries/160/takeoffs/179')

    expect(content.querySelector('img')).toBeNull()
    expect(content.textContent).toContain(maliciousName)
  })

  it('never parses a wind summary as markup either', () => {
    const content = buildSitePopupContent('Site', '<script>window.__pwned = true</script>', '/countries/160/takeoffs/179')

    expect(content.querySelector('script')).toBeNull()
  })
})

describe('unclusteredCategoryFilter', () => {
  it('excludes clustered points and matches only the given windCategory', () => {
    expect(unclusteredCategoryFilter('all')).toEqual(['all', ['!', ['has', 'point_count']], ['==', ['get', 'windCategory'], 'all']])
  })
})

function mapData(overrides: Partial<TakeoffsMapData>): TakeoffsMapData {
  return {
    sites: { type: 'FeatureCollection', features: [] },
    rays: { type: 'FeatureCollection', features: [] },
    excludedCount: 0,
    plottedCount: 0,
    ...overrides,
  }
}

describe('TakeoffsMapLegend', () => {
  it('always shows the plotted count', () => {
    render(<TakeoffsMapLegend mapData={mapData({ plottedCount: 4064 })} />)

    screen.getByText(/4064 takeoffs plotted/)
  })

  // D2: "the legend's excluded count clause deleted" is one of the six mutations that leaves
  // `pnpm run check` green — #12/#10's shared rule is that excluding takeoffs from the map is
  // fine, doing it silently is not. This is the only place that clause is asserted at the unit
  // level; the directory's own index.test.tsx stubs the whole map component out.
  it('shows the excluded count when takeoffs were excluded, visibly, not just tracked internally', () => {
    render(<TakeoffsMapLegend mapData={mapData({ plottedCount: 4057, excludedCount: 1955 })} />)

    screen.getByText(/1955 excluded — no recorded location/)
  })

  it('shows no excluded-count clause when nothing was excluded', () => {
    render(<TakeoffsMapLegend mapData={mapData({ plottedCount: 10, excludedCount: 0 })} />)

    expect(screen.queryByText(/excluded/)).toBeNull()
  })
})

// A fake object shaped like exactly the slice of MapLibreMap wireSitePopups actually calls:
// `on` to register the click handler (captured here instead of really firing through MapLibre's
// own event system) and `queryRenderedFeatures` to stand in for whatever MapLibre would have
// found under the click.
function fakeMapWithFeature(properties: Record<string, unknown>): { map: MapLibreMap; click: () => void } {
  const handlers = new Map<string, (event: MapMouseEvent) => void>()
  const map = {
    on: vi.fn((event: string, layerId: string, handler: (event: MapMouseEvent) => void) => {
      if (event === 'click') handlers.set(layerId, handler)
    }),
    queryRenderedFeatures: vi.fn(() => [
      { properties, geometry: { type: 'Point', coordinates: [10, 60] } },
    ]),
  } as unknown as MapLibreMap
  return {
    map,
    click: () => handlers.get(UNCLUSTERED_NONE_LAYER_ID)?.({ point: { x: 0, y: 0 } } as unknown as MapMouseEvent),
  }
}

describe('wireSitePopups', () => {
  // The exact mutation the review that prompted this test caught: `feature.properties?.takeoffId`
  // swapped for `feature.properties?.regionId` left `tsc`, `eslint` and all 484 tests green,
  // because nothing called this function directly. A feature carrying both a takeoffId AND an
  // unrelated numeric property (regionId) is what actually distinguishes "read the right field"
  // from "read A field."
  it('pins the takeoffId (not some other numeric property) and the given countryId into the popup detail link', () => {
    const { map, click } = fakeMapWithFeature({ name: 'Løten', windSummary: 'x', takeoffId: 179, regionId: 999 })

    wireSitePopups(map, 160)
    click()

    const popupInstance = vi.mocked(Popup).mock.results[0]!.value
    const domContent = popupInstance.setDOMContent.mock.calls[0][0] as HTMLElement
    expect(domContent.querySelector('a')?.getAttribute('href')).toBe('/countries/160/takeoffs/179')
  })

  it('pins the given countryId, not a fixed or swapped one', () => {
    const { map, click } = fakeMapWithFeature({ name: 'Løten', windSummary: 'x', takeoffId: 179 })

    wireSitePopups(map, 203)
    click()

    const popupInstance = vi.mocked(Popup).mock.results[0]!.value
    const domContent = popupInstance.setDOMContent.mock.calls[0][0] as HTMLElement
    expect(domContent.querySelector('a')?.getAttribute('href')).toBe('/countries/203/takeoffs/179')
  })

  // #11 fix round: the single-marker map on a takeoff's own detail page must not link its own
  // popup back to the page the visitor is already on — checked against the real
  // window.location.pathname, not a mode flag passed into this function.
  it('renders plain text, not a self-link, when the popup would point at the current page', () => {
    window.history.pushState(null, '', '/countries/160/takeoffs/179')
    const { map, click } = fakeMapWithFeature({ name: 'Drammen, Solbergåsen', windSummary: 'x', takeoffId: 179 })

    wireSitePopups(map, 160)
    click()

    const popupInstance = vi.mocked(Popup).mock.results[0]!.value
    const domContent = popupInstance.setDOMContent.mock.calls[0][0] as HTMLElement
    expect(domContent.querySelector('a')).toBeNull()
    expect(domContent.textContent).toContain('Drammen, Solbergåsen')

    window.history.pushState(null, '', '/')
  })

  it('still links normally when the popup points somewhere other than the current page', () => {
    window.history.pushState(null, '', '/countries/160/takeoffs')
    const { map, click } = fakeMapWithFeature({ name: 'Drammen, Solbergåsen', windSummary: 'x', takeoffId: 179 })

    wireSitePopups(map, 160)
    click()

    const popupInstance = vi.mocked(Popup).mock.results[0]!.value
    const domContent = popupInstance.setDOMContent.mock.calls[0][0] as HTMLElement
    expect(domContent.querySelector('a')?.getAttribute('href')).toBe('/countries/160/takeoffs/179')

    window.history.pushState(null, '', '/')
  })

  // #47's own review gap, closed directly: a missing or non-numeric takeoffId must never reach
  // a popup linking to /takeoffs/NaN.
  it('never opens a popup when the feature carries no valid takeoffId', () => {
    const { map, click } = fakeMapWithFeature({ name: 'Løten', windSummary: 'x' })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    wireSitePopups(map, 160)
    click()

    expect(Popup).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
