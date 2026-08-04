import { describe, expect, it } from 'vitest'
import { buildFlownSitesGeoJSON } from './build-flown-sites-geojson'
import type { FlownSite } from '@/features/browse-flown-sites-map/join-flown-sites'

function site(overrides: Partial<FlownSite> = {}): FlownSite {
  return { takeoffId: 15, countryId: 160, name: 'Bismo (Riksanlegget)', lat: 61.6, lon: 8.5, flightCount: 3, ...overrides }
}

describe('buildFlownSitesGeoJSON', () => {
  it('turns each site into a Point feature at [lon, lat], carrying its identity and flight count as properties', () => {
    const geojson = buildFlownSitesGeoJSON([site()])

    expect(geojson).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [8.5, 61.6] },
          properties: { takeoffId: 15, countryId: 160, name: 'Bismo (Riksanlegget)', flightCount: 3 },
        },
      ],
    })
  })

  it('produces an empty feature collection for zero sites, not a throw', () => {
    expect(buildFlownSitesGeoJSON([])).toEqual({ type: 'FeatureCollection', features: [] })
  })

  it('carries one feature per site, in the given order, for several distinct sites', () => {
    const geojson = buildFlownSitesGeoJSON([
      site({ takeoffId: 15, name: 'Bismo' }),
      site({ takeoffId: 44, name: 'Vågå, Salknappen' }),
    ])

    expect(geojson.features.map((f) => f.properties.name)).toEqual(['Bismo', 'Vågå, Salknappen'])
  })
})
