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
import type { TakeoffDirectoryEntry } from './fetch-takeoffs'
import { buildTakeoffsMapData, type TakeoffSiteFeature, type TakeoffsMapData } from './build-takeoffs-geojson'

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
  takeoffs: TakeoffDirectoryEntry[]
  className?: string
}

const SITES_SOURCE_ID = 'takeoff-sites'
const RAYS_SOURCE_ID = 'wind-rays'
export const CLUSTER_LAYER_ID = 'takeoff-clusters'
export const UNCLUSTERED_NONE_LAYER_ID = 'takeoff-site-none'
export const UNCLUSTERED_ALL_LAYER_ID = 'takeoff-site-all'
export const UNCLUSTERED_SOME_LAYER_ID = 'takeoff-site-some'
export const WIND_RAY_LAYER_ID = 'wind-ray-lines'

const DEFAULT_SIZE_CLASSES = 'h-[70vh] w-full'
// Below this zoom, individual sites are still bundled into clusters, so a ray drawn at a
// bundled site would sit on top of a cluster circle rather than next to the site it belongs
// to — gating the whole layer to the zoom band where sites render individually keeps every
// visible ray anchored to a marker that's actually on screen.
const RAY_MIN_ZOOM = 9
const UNCLUSTERED_FILTER: ExpressionSpecification = ['!', ['has', 'point_count']]

function unclusteredCategoryFilter(category: string): ExpressionSpecification {
  return ['all', UNCLUSTERED_FILTER, ['==', ['get', 'windCategory'], category]]
}

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ')
}

// track-map.tsx gates its own window handle on NODE_ENV !== 'production', because its route
// (flights/[tripId]) is never prerendered and is safe to browser-test against `next dev`. This
// route's data is the opposite: it's the prerendered takeoffs asset check-takeoffs-prerender.mts
// and verify-takeoffs.mts both insist on testing against a real `pnpm run build && pnpm run
// start` — and `next start` always runs with NODE_ENV=production, unconditionally, regardless
// of what the environment set beforehand. A NODE_ENV gate here would silently strip this hook
// on exactly the build scripts/verify-sites-map.mts is required to run against. An explicit,
// opt-in query param instead keeps the hook out of ordinary production traffic (nobody
// navigates with `?__verifyMap` by accident) while still reaching real production output.
function isMapDebugEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('__verifyMap')
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
function buildSitePopupContent(name: string, windSummary: string): HTMLElement {
  const container = document.createElement('div')
  container.className = 'flex flex-col gap-0.5 text-sm'
  const title = document.createElement('strong')
  title.textContent = name
  const wind = document.createElement('span')
  wind.className = 'opacity-70'
  wind.textContent = windSummary
  // #11 (a site detail page) doesn't exist yet — #9 and #4 already established the rule for
  // this exact situation (see index.tsx's own comment): show what a click would need, never a
  // link to a route that 404s.
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

function wireSitePopups(map: MapLibreMap): void {
  const siteLayers = [UNCLUSTERED_NONE_LAYER_ID, UNCLUSTERED_ALL_LAYER_ID, UNCLUSTERED_SOME_LAYER_ID]
  for (const layerId of siteLayers) {
    map.on('click', layerId, (event) => {
      const feature = siteFeatureAt(map, event, layerId)
      if (!feature) return
      const coordinates = pointCoordinates(feature)
      const name = String(feature.properties?.name ?? '')
      const windSummary = String(feature.properties?.windSummary ?? '')
      new Popup().setLngLat(coordinates).setDOMContent(buildSitePopupContent(name, windSummary)).addTo(map)
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

// #10's map view: clustered at low zoom (MapLibre's own built-in clustering, see
// addSitesAndClusters), wind rendered per site (see build-takeoffs-geojson.ts for the three
// deliberate categories), reusing the same OSM raster style and map-instance-on-window
// pattern track-map.tsx already established rather than a second map configuration. Takes the
// already-fetched dataset as a prop — see index.tsx, which holds the one fetch this feature
// makes (via useTakeoffs) and passes it to both the list and this map, so switching views
// never triggers a second network request.
export function TakeoffsMap({ takeoffs, className }: TakeoffsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const mapData = useMemo(() => buildTakeoffsMapData(takeoffs), [takeoffs])

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
      wireSitePopups(map)
      wireHoverCursor(map)
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
  }, [mapData])

  if (mapData.plottedCount === 0) {
    return (
      <div
        className={classes(
          DEFAULT_SIZE_CLASSES,
          'flex items-center justify-center rounded-md border border-dashed border-black/15 text-sm opacity-60 dark:border-white/20',
          className,
        )}
      >
        No takeoffs with a recorded location
      </div>
    )
  }

  return (
    <div className={classes('flex flex-col gap-2', className)}>
      <div ref={containerRef} className={classes(DEFAULT_SIZE_CLASSES, 'overflow-hidden rounded-md')} />
      <TakeoffsMapLegend mapData={mapData} />
    </div>
  )
}

function TakeoffsMapLegend({ mapData }: { mapData: TakeoffsMapData }) {
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
