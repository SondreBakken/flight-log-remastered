// Pure — turns a takeoff dataset into the two GeoJSON collections index.tsx (this directory's
// map component) feeds MapLibre. No DOM, no map instance, so the two hazards #10 exists to
// handle are each pinned by a plain unit test rather than only ever exercised through a live
// map: placeholder coordinates never producing a plotted feature, and wind=0 / wind=255 never
// producing an ordinary directional ray.
import { decodeWindDirections, OCTANTS_CLOCKWISE, type CompassOctant } from '@/lib/flightlog/wind'
import { hasKnownLocation } from '@/lib/flightlog/has-known-location'

// The minimal shape this map needs from a takeoff — deliberately not a specific feature's wire
// type (TakeoffDirectoryEntry, Takeoff, …): this module has two page-owning callers in two
// different features, and importing either one's own type here would make this shared UI
// component depend sideways on a feature instead of the other way around. Both
// TakeoffDirectoryEntry and the server-side Takeoff type already satisfy this structurally.
export type TakeoffMapEntry = {
  takeoffId: number
  name: string
  lat: number
  lon: number
  wind: number
}

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
  // Precomputed here, not in the map component — index.tsx has no business decoding a wind
  // byte itself (that's wind.ts's job, reused here, not reinvented there) or composing English
  // copy for a popup.
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
  // How many takeoffs carry a corrupt or placeholder coordinate (see hasKnownLocation for the
  // three shapes that takes — the full lat=0/lon=0 placeholder, 1948 of Norway's 6012 real
  // rows, plus 7 more with one axis dropped or both corrupted near Null Island) and are
  // therefore never plotted — 1955 total. #10's explicit rule, the same one #12 settled for
  // the list view: excluding them is fine, doing it silently is not, so the caller renders
  // this rather than the map just quietly showing fewer markers.
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

function toSiteFeature(takeoff: TakeoffMapEntry): TakeoffSiteFeature {
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

// Below this zoom, individual sites are still bundled into clusters (see clusterMaxZoom in
// index.tsx), so a ray drawn at a bundled site would sit on top of a cluster circle rather than
// next to the site it belongs to — gating the whole ray layer to the zoom band where sites
// render individually keeps every visible ray anchored to a marker that's actually on screen.
// Also doubles as the reference zoom for DEFAULT_RAY_LENGTH_DEGREES below: the zoom a ray first
// becomes visible at is the zoom it should already look right at.
export const RAY_MIN_ZOOM = 9

const WEB_MERCATOR_TILE_PX = 256

// MapLibre's Web Mercator projection maps longitude degrees to screen pixels linearly and
// independent of latitude — pixelsPerDegreeLongitude = tilePx * 2**zoom / 360 — so a ray built
// from a FIXED degree length grows by exactly 2x per zoom level: 64x across the 9-to-15 band a
// ray is actually visible in (7.3px at 9, hidden under the site's own 6px marker; 466px at 15,
// running off every screen edge and reading as a property boundary instead of a symbol). A
// symbolic mark should hold a constant screen size instead. RAY_LENGTH_PIXELS is that target;
// rayLengthDegreesAtZoom converts it to the degree length that renders at exactly that many
// pixels at a given zoom — index.tsx recomputes ray geometry with it on every zoom change (see
// rescaleRayLength below), the same way MapLibre's own circle-radius stops already keep the
// site markers a fixed pixel size without this file's help.
//
// rayEndpoint's own cos(latitude) term, below, is a separate, orthogonal correction: it keeps
// a ray isotropic — equal length on every bearing — at a GIVEN zoom and latitude. This constant
// is what keeps that length constant ACROSS zoom levels; the two compose rather than overlap.
const RAY_LENGTH_PIXELS = 24

export function rayLengthDegreesAtZoom(zoom: number): number {
  const pixelsPerDegreeLongitude = (WEB_MERCATOR_TILE_PX * 2 ** zoom) / 360
  return RAY_LENGTH_PIXELS / pixelsPerDegreeLongitude
}

const DEFAULT_RAY_LENGTH_DEGREES = rayLengthDegreesAtZoom(RAY_MIN_ZOOM)

// Compass bearing in degrees clockwise from north, one per octant — the geometric angle a ray
// is drawn at, not a second copy of wind.ts's bit mapping. Derived from OCTANTS_CLOCKWISE
// (bearing = 45° per clockwise step) rather than written out as a second hand-kept literal, the
// same reason wind.ts derives BIT_FOR_OCTANT from that same array instead of a second one: two
// independent orderings of the same eight compass points can drift apart, one can't.
const BEARING_DEGREES: Readonly<Record<CompassOctant, number>> = Object.fromEntries(
  OCTANTS_CLOCKWISE.map((octant, clockwiseIndex) => [octant, clockwiseIndex * 45]),
) as Record<CompassOctant, number>

// Offsets a ray's endpoint from its site by a fixed small distance in the given compass
// direction. The longitude term is scaled by cos(latitude) so the ray reads as the same visual
// length at Norway's latitudes as it would at the equator — plain unscaled degrees would draw a
// visibly SHORTENED ray east-west this far north (a degree of longitude is worth barely half a
// degree of latitude's ground distance at 60N), not a stretched one.
function rayEndpoint(origin: [number, number], octant: CompassOctant, rayLengthDegrees: number): [number, number] {
  const [lon, lat] = origin
  const bearingRadians = (BEARING_DEGREES[octant] * Math.PI) / 180
  const latRadians = (lat * Math.PI) / 180
  const deltaLat = rayLengthDegrees * Math.cos(bearingRadians)
  const deltaLon = (rayLengthDegrees * Math.sin(bearingRadians)) / Math.cos(latRadians)
  return [lon + deltaLon, lat + deltaLat]
}

// A ray per active octant — but only for 'some', the ordinary directional case. 'none' has
// nothing to draw a ray for by construction (decodeWindDirections(0) is []), so the explicit
// category check here exists entirely for 'all': without it, wind=255 would decode to all
// eight octants and draw eight rays, which is exactly the "eight arrows" rendering #10's issue
// says is not a meaningful reading of "works everywhere".
function toRayFeatures(takeoff: TakeoffMapEntry, rayLengthDegrees: number): WindRayFeature[] {
  if (classifyWind(takeoff.wind) !== 'some') return []
  const origin: [number, number] = [takeoff.lon, takeoff.lat]
  return decodeWindDirections(takeoff.wind).map((octant) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [origin, rayEndpoint(origin, octant, rayLengthDegrees)] },
    properties: { takeoffId: takeoff.takeoffId, octant },
  }))
}

export function buildTakeoffsMapData(
  takeoffs: TakeoffMapEntry[],
  rayLengthDegrees: number = DEFAULT_RAY_LENGTH_DEGREES,
): TakeoffsMapData {
  const located = takeoffs.filter(hasKnownLocation)
  return {
    sites: { type: 'FeatureCollection', features: located.map(toSiteFeature) },
    rays: { type: 'FeatureCollection', features: located.flatMap((takeoff) => toRayFeatures(takeoff, rayLengthDegrees)) },
    excludedCount: takeoffs.length - located.length,
    plottedCount: located.length,
  }
}

// Recomputes every ray's endpoint at a new length, keeping its origin and octant — the cheap
// half of buildTakeoffsMapData's work (no wind decoding, no placeholder filtering, no site
// features), so index.tsx can call this on every zoom change to keep rays screen-constant (see
// rayLengthDegreesAtZoom above) without re-running the whole build — including the placeholder
// filter and wind classification — on every zoom tick.
export function rescaleRayLength(rays: WindRaysGeoJSON, rayLengthDegrees: number): WindRaysGeoJSON {
  return {
    type: 'FeatureCollection',
    features: rays.features.map((ray) => ({
      ...ray,
      geometry: {
        type: 'LineString',
        coordinates: [ray.geometry.coordinates[0], rayEndpoint(ray.geometry.coordinates[0], ray.properties.octant, rayLengthDegrees)],
      },
    })),
  }
}
