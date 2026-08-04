// Pure — turns a matched-site list into the single GeoJSON collection index.tsx (this
// directory's map component) feeds MapLibre. No DOM, no map instance, same split as
// takeoffs-map/build-takeoffs-geojson.ts, for the same reason: a plain unit test can pin the
// feature<->site correspondence without a real GL context.
import type { FlownSite } from '@/features/browse-flown-sites-map/join-flown-sites'

export type FlownSiteProperties = {
  takeoffId: number
  countryId: number
  name: string
  flightCount: number
}

export type FlownSiteFeature = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: FlownSiteProperties
}

export type FlownSitesGeoJSON = {
  type: 'FeatureCollection'
  features: FlownSiteFeature[]
}

function toSiteFeature(site: FlownSite): FlownSiteFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [site.lon, site.lat] },
    properties: { takeoffId: site.takeoffId, countryId: site.countryId, name: site.name, flightCount: site.flightCount },
  }
}

export function buildFlownSitesGeoJSON(sites: FlownSite[]): FlownSitesGeoJSON {
  return { type: 'FeatureCollection', features: sites.map(toSiteFeature) }
}
