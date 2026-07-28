// Pure — turns the takeoff dataset the browser already holds (see fetch-takeoffs.ts) into the
// two GeoJSON collections takeoffs-map.tsx feeds MapLibre. No DOM, no map instance, so the two
// hazards #10 exists to handle are each pinned by a plain unit test rather than only ever
// exercised through a live map: placeholder coordinates never producing a plotted feature, and
// wind=0 / wind=255 never producing an ordinary directional ray.
import { decodeWindDirections, type CompassOctant } from '@/lib/flightlog/wind'
import { hasKnownLocation } from './select-visible-takeoffs'
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'

// Neither end of the wind byte is a real direction reading (see wind.ts's own decode and
// #10's issue notes: 991 of Norway's 6012 takeoffs record wind=0, "nothing recorded", and 366
// record wind=255, "every direction"). Both get a category of their own so the map component
// can render them as deliberately distinct markers instead of either falling out of a loop
// over set bits — a wind=0 site rendered as zero rays already happens to look distinct, but a
// wind=255 site rendered as eight rays would look like an ordinary, if unusually busy, site
// rather than the special case it is.
export type WindRenderCategory = 'none' | 'all' | 'some'

export type TakeoffSiteProperties = {
  takeoffId: number
  name: string
  windCategory: WindRenderCategory
  // Precomputed here, not in the map component — takeoffs-map.tsx has no business decoding a
  // wind byte itself (that's wind.ts's job, reused here, not reinvented there) or composing
  // English copy for a popup.
  windSummary: string
}

export type TakeoffSiteFeature = {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: TakeoffSiteProperties
}

export type TakeoffSitesGeoJSON = {
  type: 'FeatureCollection'
  features: TakeoffSiteFeature[]
}

export type WindRayProperties = {
  takeoffId: number
  octant: CompassOctant
}

export type WindRayFeature = {
  type: 'Feature'
  geometry: { type: 'LineString'; coordinates: [[number, number], [number, number]] }
  properties: WindRayProperties
}

export type WindRaysGeoJSON = {
  type: 'FeatureCollection'
  features: WindRayFeature[]
}

export type TakeoffsMapData = {
  sites: TakeoffSitesGeoJSON
  rays: WindRaysGeoJSON
  // How many takeoffs carry the lat=0/lon=0 placeholder (see hasKnownLocation) and are
  // therefore never plotted — 1948 of Norway's 6012 in the real fixture. #10's explicit rule,
  // the same one #12 settled for the list view: excluding them is fine, doing it silently is
  // not, so the caller renders this rather than the map just quietly showing fewer markers.
  excludedCount: number
  plottedCount: number
}

function classifyWind(wind: number): WindRenderCategory {
  if (wind === 0) return 'none'
  if (wind === 255) return 'all'
  return 'some'
}

function summarizeWind(wind: number, category: WindRenderCategory): string {
  if (category === 'none') return 'No wind direction recorded'
  if (category === 'all') return 'Works in every direction'
  return `Works in ${decodeWindDirections(wind).join(', ')}`
}

function toSiteFeature(takeoff: TakeoffDirectoryEntry): TakeoffSiteFeature {
  const category = classifyWind(takeoff.wind)
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [takeoff.lon, takeoff.lat] },
    properties: {
      takeoffId: takeoff.takeoffId,
      name: takeoff.name,
      windCategory: category,
      windSummary: summarizeWind(takeoff.wind, category),
    },
  }
}

// Degrees, not metres — small enough to read as a per-site ray at the zoom level the layer
// itself is gated to (see RAY_MIN_ZOOM in takeoffs-map.tsx), independent of latitude.
const RAY_LENGTH_DEGREES = 0.01

// Compass bearing in degrees clockwise from north, one per octant — the geometric angle a ray
// is drawn at, not a second copy of wind.ts's bit mapping (OCTANTS_CLOCKWISE only orders
// names; it carries no angle).
const BEARING_DEGREES: Readonly<Record<CompassOctant, number>> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
}

// Offsets a ray's endpoint from its site by a fixed small distance in the given compass
// direction. The longitude term is scaled by cos(latitude) so the ray reads as the same
// visual length at Norway's latitudes as it would at the equator — plain unscaled degrees
// would draw a visibly stretched ray east-west this far north.
function rayEndpoint(origin: [number, number], octant: CompassOctant): [number, number] {
  const [lon, lat] = origin
  const bearingRadians = (BEARING_DEGREES[octant] * Math.PI) / 180
  const latRadians = (lat * Math.PI) / 180
  const deltaLat = RAY_LENGTH_DEGREES * Math.cos(bearingRadians)
  const deltaLon = (RAY_LENGTH_DEGREES * Math.sin(bearingRadians)) / Math.cos(latRadians)
  return [lon + deltaLon, lat + deltaLat]
}

// A ray per active octant — but only for 'some', the ordinary directional case. 'none' has
// nothing to draw a ray for by construction (decodeWindDirections(0) is []), so the explicit
// category check here exists entirely for 'all': without it, wind=255 would decode to all
// eight octants and draw eight rays, which is exactly the "eight arrows" rendering #10's issue
// says is not a meaningful reading of "works everywhere".
function toRayFeatures(takeoff: TakeoffDirectoryEntry): WindRayFeature[] {
  if (classifyWind(takeoff.wind) !== 'some') return []
  const origin: [number, number] = [takeoff.lon, takeoff.lat]
  return decodeWindDirections(takeoff.wind).map((octant) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [origin, rayEndpoint(origin, octant)] },
    properties: { takeoffId: takeoff.takeoffId, octant },
  }))
}

export function buildTakeoffsMapData(takeoffs: TakeoffDirectoryEntry[]): TakeoffsMapData {
  const located = takeoffs.filter(hasKnownLocation)
  return {
    sites: { type: 'FeatureCollection', features: located.map(toSiteFeature) },
    rays: { type: 'FeatureCollection', features: located.flatMap(toRayFeatures) },
    excludedCount: takeoffs.length - located.length,
    plottedCount: located.length,
  }
}
