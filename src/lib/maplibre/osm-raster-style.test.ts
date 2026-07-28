import { describe, expect, it } from 'vitest'
import type { StyleSpecification } from 'maplibre-gl'
import { OSM_ATTRIBUTION, osmRasterStyle } from './osm-raster-style'

// osmRasterStyle's declared return type is MapOptions['style'] (string | StyleSpecification),
// the type MapLibre itself accepts — but the function only ever builds the object form. Cast
// once here rather than at every call site below.
function buildStyle(): StyleSpecification {
  return osmRasterStyle() as StyleSpecification
}

// D2: "the OSM tile URL and tile size destroyed" is one of the six mutations that left
// `pnpm run check` fully green on the sites-map branch — zero tests anywhere referenced
// osmRasterStyle, OSM_ATTRIBUTION, or 'openstreetmap' before this file. Both track-map.tsx and
// takeoffs-map.tsx share this one style, so a regression here silently loses tiles on every map
// in the app at once, not just the one a developer happened to be looking at.
describe('osmRasterStyle', () => {
  it('points the raster source at the real OpenStreetMap tile template, not a broken or placeholder URL', () => {
    const style = buildStyle()

    const source = style.sources.osm as { type: string; tiles: string[]; tileSize: number }
    expect(source.tiles).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'])
  })

  it('uses the standard 256px raster tile size, not an unset or mismatched one', () => {
    const style = buildStyle()

    const source = style.sources.osm as { tileSize: number }
    expect(source.tileSize).toBe(256)
  })

  it('carries a real OpenStreetMap attribution, required by their tile usage policy', () => {
    expect(OSM_ATTRIBUTION).toContain('openstreetmap.org')
    expect(OSM_ATTRIBUTION.toLowerCase()).toContain('openstreetmap')

    const style = buildStyle()
    const source = style.sources.osm as { attribution: string }
    expect(source.attribution).toBe(OSM_ATTRIBUTION)
  })

  it('renders the source through a raster layer bound to it, not a different layer type or an unbound source', () => {
    const style = buildStyle()

    expect(style.layers).toHaveLength(1)
    expect(style.layers[0]).toMatchObject({ type: 'raster', source: 'osm' })
  })

  it('builds a fresh style object per call — MapLibre takes ownership of the one it is given', () => {
    expect(buildStyle()).not.toBe(buildStyle())
  })
})
