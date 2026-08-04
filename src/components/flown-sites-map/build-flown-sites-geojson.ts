// Pure — turns a matched-site list into the single GeoJSON collection index.tsx (this
// directory's map component) feeds MapLibre. No DOM, no map instance, same split as
// takeoffs-map/build-takeoffs-geojson.ts, for the same reason: a plain unit test can pin the
// feature<->site correspondence without a real GL context.

// The minimal shape this map needs from a matched site — deliberately not join-flown-sites.ts's
// own FlownSite: this directory is shared UI (components/), and importing a features/ type here
// would make it depend sideways on a feature instead of the other way around, the same reasoning
// takeoffs-map/build-takeoffs-geojson.ts's own TakeoffMapEntry gives for not importing
// TakeoffDirectoryEntry or Takeoff directly. FlownSite already satisfies this structurally, so
// the feature passes result.sites straight through with no mapping step required.
export type FlownSiteMarker = {
  takeoffId: number
  countryId: number
  name: string
  lat: number
  lon: number
  flightCount: number
}

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

function toSiteFeature(site: FlownSiteMarker): FlownSiteFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [site.lon, site.lat] },
    properties: { takeoffId: site.takeoffId, countryId: site.countryId, name: site.name, flightCount: site.flightCount },
  }
}

export function buildFlownSitesGeoJSON(sites: FlownSiteMarker[]): FlownSitesGeoJSON {
  return { type: 'FeatureCollection', features: sites.map(toSiteFeature) }
}
