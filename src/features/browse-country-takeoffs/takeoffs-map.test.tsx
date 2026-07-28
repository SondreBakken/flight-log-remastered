import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { buildSitePopupContent, TakeoffsMapLegend, unclusteredCategoryFilter } from './takeoffs-map'
import type { TakeoffsMapData } from './build-takeoffs-geojson'

// The real TakeoffsMap mounts an actual maplibre-gl MapLibreMap against a canvas — jsdom has no
// WebGL context (see index.test.tsx's own doc comment on why that whole component is stubbed
// in its suite). But not everything this file exports needs one: buildSitePopupContent is
// plain DOM, TakeoffsMapLegend is a plain React component that only reads TakeoffsMapData, and
// unclusteredCategoryFilter is a pure function building a filter expression. All three are
// covered here directly, with no map involved — the browser script
// (scripts/verify-sites-map.mts) is still what proves the map actually renders these, but a
// green `pnpm run check` should not depend on remembering to run that by hand.

describe('buildSitePopupContent', () => {
  it('renders the takeoff name and wind summary as visible text', () => {
    const content = buildSitePopupContent('Bergen', 'Works in N, S')

    expect(content.textContent).toContain('Bergen')
    expect(content.textContent).toContain('Works in N, S')
  })

  // D2: "popup textContent changed to innerHTML" is one of the six mutations that leaves
  // `pnpm run check` green — a takeoff name is upstream flightlog.org content, not something
  // this app controls the shape of, so an innerHTML assignment would turn a scraped name into
  // an injection sink. Asserting the literal markup never parses into a real element (rather
  // than merely checking the visible text, which an innerHTML assignment would also produce
  // correctly for this exact input) is what actually distinguishes textContent from innerHTML.
  it('never parses a takeoff name as markup, even if it contains an HTML-looking string', () => {
    const maliciousName = '<img src=x onerror="window.__pwned = true">'
    const content = buildSitePopupContent(maliciousName, 'No wind direction recorded')

    expect(content.querySelector('img')).toBeNull()
    expect(content.textContent).toContain(maliciousName)
  })

  it('never parses a wind summary as markup either', () => {
    const content = buildSitePopupContent('Site', '<script>window.__pwned = true</script>')

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
  // level; index.test.tsx stubs the whole map component out.
  it('shows the excluded count when takeoffs were excluded, visibly, not just tracked internally', () => {
    render(<TakeoffsMapLegend mapData={mapData({ plottedCount: 4057, excludedCount: 1955 })} />)

    screen.getByText(/1955 excluded — no recorded location/)
  })

  it('shows no excluded-count clause when nothing was excluded', () => {
    render(<TakeoffsMapLegend mapData={mapData({ plottedCount: 10, excludedCount: 0 })} />)

    expect(screen.queryByText(/excluded/)).toBeNull()
  })
})
