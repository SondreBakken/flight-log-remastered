import type { MapOptions } from 'maplibre-gl'

// Shared by every MapLibre map in this app (currently show-flight-track/track-map.tsx and
// browse-country-takeoffs/takeoffs-map.tsx) — see #10's own instruction to reuse the existing
// map setup rather than starting a second configuration. A single OSM raster style kept in
// one place is what makes that true by construction rather than by two hand-kept-in-sync
// copies.

export type MapStyle = NonNullable<MapOptions['style']>

export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

// Built per map instance because MapLibre takes ownership of the style object it is given.
export function osmRasterStyle(): MapStyle {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: OSM_ATTRIBUTION,
      },
    },
    layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
  }
}
