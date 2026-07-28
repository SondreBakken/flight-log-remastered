'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  LngLatBounds,
  MapLibreMap,
  NavigationControl,
  Popup,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { osmRasterStyle } from '@/lib/maplibre/osm-raster-style'
import { isMapDebugEnabled } from '@/lib/maplibre/map-debug'
import {
  buildTakeoffsMapData,
  RAY_MIN_ZOOM,
  rayLengthDegreesAtZoom,
  rescaleRayLength,
  type TakeoffMapEntry,
  type TakeoffSiteFeature,
  type TakeoffsMapData,
} from './build-takeoffs-geojson'
import {
  SITES_SOURCE_ID,
  RAYS_SOURCE_ID,
  CLUSTER_LAYER_ID,
  UNCLUSTERED_NONE_LAYER_ID,
  UNCLUSTERED_ALL_LAYER_ID,
  UNCLUSTERED_SOME_LAYER_ID,
  WIND_RAY_LAYER_ID,
} from './site-layer-ids'

// Re-exported so anything that already imports a layer id from this module (the map component
// itself is the natural place to look for one) keeps working — the ids themselves live in
// site-layer-ids.ts so scripts/verify-sites-map.mts can import them too without pulling in
// maplibre-gl or this file's CSS import (see that module's own doc comment).
export { CLUSTER_LAYER_ID, UNCLUSTERED_NONE_LAYER_ID, UNCLUSTERED_ALL_LAYER_ID, UNCLUSTERED_SOME_LAYER_ID, WIND_RAY_LAYER_ID }

declare global {
  interface Window {
    // Same mechanism track-map.tsx already uses (see its own doc comment): there's no test
    // runner driving a real GL context in this repo, so scripts/verify-sites-map.mts needs a
    // handle on the live map to assert source/cluster/layer state directly rather than trust a
    // screenshot alone.
    __takeoffsMap?: MapLibreMap
    // The exact data the map was built from — lets the browser script assert the placeholder
    // exclusion count, both special wind categories, and the ray/site correspondence directly
    // against real feature properties, rather than re-deriving any of it from rendered pixels.
    __takeoffsMapData?: TakeoffsMapData
  }
}

type TakeoffsMapProps = {
  takeoffs: TakeoffMapEntry[]
  countryId: number
  // Controls the sized map container — defaults to a directory-scale viewport
  // (DEFAULT_SIZE_CLASSES). A caller embedding a single-site map inline (e.g. the takeoff
  // detail page) passes its own, smaller sizing here instead.
  className?: string
}

const DEFAULT_SIZE_CLASSES = 'h-[70vh] w-full'
const UNCLUSTERED_FILTER: ExpressionSpecification = ['!', ['has', 'point_count']]

export function unclusteredCategoryFilter(category: string): ExpressionSpecification {
  return ['all', UNCLUSTERED_FILTER, ['==', ['get', 'windCategory'], category]]
}

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function siteBounds(features: TakeoffSiteFeature[]): LngLatBounds | null {
  if (features.length === 0) return null
  const first = features[0]!.geometry.coordinates
  return features.reduce(
    (bounds, feature) => bounds.extend(feature.geometry.coordinates),
    new LngLatBounds(first, first),
  )
}

function siteFeatureAt(map: MapLibreMap, event: MapMouseEvent, layerId: string): MapGeoJSONFeature | undefined {
  return map.queryRenderedFeatures(event.point, { layers: [layerId] })[0]
}

// queryRenderedFeatures's geometry type is a broad GeoJSON union; every layer this reads from
// (clusters and the three unclustered site layers) is built from the Point source above, so
// this narrows what's already known to be true rather than performing a runtime geometry
// check.
function pointCoordinates(feature: MapGeoJSONFeature): [number, number] {
  const geometry = feature.geometry as { type: 'Point'; coordinates: [number, number] }
  return geometry.coordinates
}

// Escapes the popup content via real DOM nodes (textContent), not an HTML string — a takeoff
// name is upstream flightlog.org content, not something this app controls the shape of.
// Exported so this stays pinned by a direct unit test (no MapLibre/WebGL context needed to
// call it — it's plain DOM) rather than only ever exercised through a live map click.
//
// `detailHref` is a plain `<a>`, not a `next/link` `<Link>` — this element is built imperatively
// for MapLibre's `Popup.setDOMContent`, entirely outside React's own tree, so there is no
// component instance for `next/link` to attach client-side routing to here. A plain anchor
// still navigates correctly; it just costs a full page load rather than a client transition,
// the same tradeoff any content built outside React already has on this page. `null` means the
// popup is for the page the visitor is already on (the takeoff detail page's own single-marker
// map) — plain text instead of a self-link to nowhere new.
export function buildSitePopupContent(name: string, windSummary: string, detailHref: string | null): HTMLElement {
  const container = document.createElement('div')
  container.className = 'flex flex-col gap-0.5 text-sm'
  const title = document.createElement(detailHref ? 'a' : 'span')
  if (detailHref) title.setAttribute('href', detailHref)
  title.className = classes('font-semibold', detailHref ? 'underline underline-offset-2' : undefined)
  title.textContent = name
  const wind = document.createElement('span')
  wind.className = 'opacity-70'
  wind.textContent = windSummary
  container.append(title, wind)
  return container
}

function addSitesAndClusters(map: MapLibreMap, data: TakeoffsMapData): void {
  if (map.getSource(SITES_SOURCE_ID)) return

  // MapLibre's own built-in clustering (via supercluster under the hood) — not manual
  // grouping, per #10's explicit requirement. `cluster: true` on a Point source is the whole
  // mechanism; clusterRadius/clusterMaxZoom below are just tuning.
  map.addSource(SITES_SOURCE_ID, {
    type: 'geojson',
    data: data.sites,
    cluster: true,
    clusterRadius: 50,
    clusterMaxZoom: 14,
  })

  map.addLayer({
    id: CLUSTER_LAYER_ID,
    type: 'circle',
    source: SITES_SOURCE_ID,
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 24, 750, 30],
      'circle-color': ['step', ['get', 'point_count'], '#60a5fa', 25, '#3b82f6', 100, '#1d4ed8', 750, '#1e3a8a'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.85,
    },
  })

  // Three separate layers, not one circle layer colour-branching on windCategory via a paint
  // expression — 'none' and 'all' are deliberately distinct MARKER SHAPES (radius + stroke),
  // not just distinct colours of the same dot, so a paint-only expression on a single layer
  // couldn't express the difference this issue asks for.
  map.addLayer({
    id: UNCLUSTERED_NONE_LAYER_ID,
    type: 'circle',
    source: SITES_SOURCE_ID,
    filter: unclusteredCategoryFilter('none'),
    paint: { 'circle-radius': 4, 'circle-color': '#9ca3af', 'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff' },
  })
  map.addLayer({
    id: UNCLUSTERED_ALL_LAYER_ID,
    type: 'circle',
    source: SITES_SOURCE_ID,
    filter: unclusteredCategoryFilter('all'),
    paint: { 'circle-radius': 8, 'circle-color': '#a855f7', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' },
  })
  map.addLayer({
    id: UNCLUSTERED_SOME_LAYER_ID,
    type: 'circle',
    source: SITES_SOURCE_ID,
    filter: unclusteredCategoryFilter('some'),
    paint: { 'circle-radius': 6, 'circle-color': '#16a34a', 'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff' },
  })

  map.addSource(RAYS_SOURCE_ID, { type: 'geojson', data: data.rays })
  map.addLayer({
    id: WIND_RAY_LAYER_ID,
    type: 'line',
    source: RAYS_SOURCE_ID,
    minzoom: RAY_MIN_ZOOM,
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#16a34a', 'line-width': 2 },
  })
}

function wireClusterExpansion(map: MapLibreMap): void {
  map.on('click', CLUSTER_LAYER_ID, (event) => {
    const feature = siteFeatureAt(map, event, CLUSTER_LAYER_ID)
    const clusterId = feature?.properties?.cluster_id as number | undefined
    if (clusterId === undefined) return
    const source = map.getSource(SITES_SOURCE_ID) as GeoJSONSource
    const coordinates = pointCoordinates(feature!)
    source.getClusterExpansionZoom(clusterId).then((zoom) => {
      map.easeTo({ center: coordinates, zoom })
    })
  })
}

// Exported so the takeoffId/countryId interpolation into the popup's detail link is pinned
// directly, against a fake map object standing in for MapLibre — the mutation this guards
// against (`feature.properties?.takeoffId` swapped for some other numeric property, e.g.
// `regionId`) previously left `tsc`, `eslint` and every test green, since nothing called this
// function at all.
export function wireSitePopups(map: MapLibreMap, countryId: number): void {
  const siteLayers = [UNCLUSTERED_NONE_LAYER_ID, UNCLUSTERED_ALL_LAYER_ID, UNCLUSTERED_SOME_LAYER_ID]
  for (const layerId of siteLayers) {
    map.on('click', layerId, (event) => {
      const feature = siteFeatureAt(map, event, layerId)
      if (!feature) return
      const takeoffId = Number(feature.properties?.takeoffId)
      // A malformed or missing takeoffId (see #47's own review gap on unguarded numeric
      // coercion) must never open a popup linking to /takeoffs/NaN — silently skip rather than
      // render a broken link.
      if (!Number.isFinite(takeoffId)) {
        console.error('[TakeoffsMap] site feature is missing a valid takeoffId', feature.properties)
        return
      }
      const coordinates = pointCoordinates(feature)
      const name = String(feature.properties?.name ?? '')
      const windSummary = String(feature.properties?.windSummary ?? '')
      const detailHref = `/countries/${countryId}/takeoffs/${takeoffId}`
      // The single-marker map on a takeoff's own detail page would otherwise link right back to
      // the page the visitor is already reading — not a mode flag on this function, just a
      // comparison against the real current URL, so it applies uniformly regardless of caller.
      const isCurrentPage = typeof window !== 'undefined' && window.location.pathname === detailHref
      new Popup()
        .setLngLat(coordinates)
        .setDOMContent(buildSitePopupContent(name, windSummary, isCurrentPage ? null : detailHref))
        .addTo(map)
    })
  }
}

function wireHoverCursor(map: MapLibreMap): void {
  const interactiveLayers = [
    CLUSTER_LAYER_ID,
    UNCLUSTERED_NONE_LAYER_ID,
    UNCLUSTERED_ALL_LAYER_ID,
    UNCLUSTERED_SOME_LAYER_ID,
  ]
  for (const layerId of interactiveLayers) {
    map.on('mouseenter', layerId, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', layerId, () => {
      map.getCanvas().style.cursor = ''
    })
  }
}

// D4: a fixed-degree ray grows 2x per zoom level on screen (64x across the 9-to-15 band it's
// actually visible in — see rayLengthDegreesAtZoom's own doc comment), reading as a tiny mark
// at RAY_MIN_ZOOM and a property boundary well past it. Recomputes every ray's endpoint at the
// zoom-appropriate length on every 'zoomend' — 'zoomend', not the continuous 'zoom' event, so a
// drag or pinch gesture triggers one setData once it settles rather than one per animation
// frame. rescaleRayLength only touches ray endpoints (origin and octant carried through
// unchanged), not buildTakeoffsMapData's full rebuild — the placeholder filter and wind
// classification #10's own measurement pins at 1.75ms for the whole dataset never need to
// re-run just because the zoom changed.
function wireRayRescaling(map: MapLibreMap, rays: TakeoffsMapData['rays']): void {
  const rescale = () => {
    const source = map.getSource(RAYS_SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(rescaleRayLength(rays, rayLengthDegreesAtZoom(map.getZoom())))
  }
  rescale()
  map.on('zoomend', rescale)
}

function mapSizeClasses(className: string | undefined): string {
  return className ?? DEFAULT_SIZE_CLASSES
}

// #10's map view: clustered at low zoom (MapLibre's own built-in clustering, see
// addSitesAndClusters), wind rendered per site (see build-takeoffs-geojson.ts for the three
// deliberate categories), reusing the same OSM raster style and map-instance-on-window pattern
// track-map.tsx already established rather than a second map configuration. Shared UI, not a
// feature: it has two page-owning callers (the takeoffs directory and the takeoff detail page),
// each composing its own surrounding chrome (the directory renders TakeoffsMapLegend alongside
// it; the detail page does not — a page about one site has no use for a three-category wind
// key) rather than this component switching on a mode flag for either.
export function TakeoffsMap({ takeoffs, countryId, className }: TakeoffsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const mapData = useMemo(() => buildTakeoffsMapData(takeoffs), [takeoffs])
  const sizeClasses = mapSizeClasses(className)

  useEffect(() => {
    const container = containerRef.current
    const bounds = siteBounds(mapData.sites.features)
    if (!container || mapRef.current || !bounds) return

    const map = new MapLibreMap({
      container,
      style: osmRasterStyle(),
      bounds,
      fitBoundsOptions: { padding: 32, maxZoom: 12 },
    })
    mapRef.current = map
    // See src/lib/maplibre/map-debug.ts for why this is a query param, not a NODE_ENV gate:
    // this route's data is the prerendered takeoffs asset check-takeoffs-prerender.mts and
    // verify-takeoffs.mts both insist on testing against a real `pnpm run build && pnpm run
    // start`, which a NODE_ENV gate can't survive. Severity of the residual exposure is low, not
    // zero: the data behind the handle is already public (flightlog.org's own takeoffs list),
    // and reaching it at all requires arbitrary script execution on the page, which needing this
    // specific query param doesn't meaningfully raise or lower.
    if (isMapDebugEnabled()) {
      window.__takeoffsMap = map
      window.__takeoffsMapData = mapData
    }

    map.addControl(new NavigationControl())

    map.on('error', (event) => {
      console.error('[TakeoffsMap]', event.error?.message ?? event)
    })

    const addLayers = () => {
      addSitesAndClusters(map, mapData)
      wireClusterExpansion(map)
      wireSitePopups(map, countryId)
      wireHoverCursor(map)
      wireRayRescaling(map, mapData.rays)
    }

    // Same reasoning as track-map.tsx: an inline style needs no fetch, so it can finish
    // loading before this effect subscribes — waiting only on the event would silently never
    // add the sites.
    if (map.isStyleLoaded()) addLayers()
    else map.once('style.load', addLayers)

    return () => {
      map.remove()
      mapRef.current = null
      if (window.__takeoffsMap === map) {
        window.__takeoffsMap = undefined
        window.__takeoffsMapData = undefined
      }
    }
  }, [mapData, countryId])

  if (mapData.plottedCount === 0) {
    return (
      <div
        className={classes(
          sizeClasses,
          'flex items-center justify-center rounded-md border border-dashed border-black/15 text-sm opacity-60 dark:border-white/20',
        )}
      >
        No takeoffs with a recorded location
      </div>
    )
  }

  return <div ref={containerRef} className={classes(sizeClasses, 'overflow-hidden rounded-md')} />
}

// Exported so the excluded-count clause (#12/#10's shared "excluding is fine, doing it
// silently is not" rule) is pinned by rendering this component directly, without mounting the
// whole map (which needs a real GL context this test suite has none of). A separate component
// from TakeoffsMap itself — see that component's own doc comment on why: each caller composes
// this alongside the map only when it actually wants a legend, rather than TakeoffsMap deciding
// that for every caller via a mode flag.
export function TakeoffsMapLegend({ mapData }: { mapData: TakeoffsMapData }) {
  return (
    <div className="flex flex-col gap-1 text-xs opacity-70">
      <p>
        {mapData.plottedCount} takeoffs plotted.{' '}
        {mapData.excludedCount > 0 &&
          `${mapData.excludedCount} excluded — no recorded location.`}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-[#16a34a]" />
          Works in specific directions (rays visible when zoomed in)
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full border-2 border-[#a855f7] bg-[#a855f7]" />
          Works in every direction
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[#9ca3af]" />
          No wind direction recorded
        </li>
      </ul>
    </div>
  )
}
