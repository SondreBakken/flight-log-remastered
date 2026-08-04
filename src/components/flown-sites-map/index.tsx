'use client'

import { useEffect, useMemo, useRef } from 'react'
import { LngLatBounds, MapLibreMap, NavigationControl, Popup, type MapGeoJSONFeature, type MapMouseEvent } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { osmRasterStyle } from '@/lib/maplibre/osm-raster-style'
import { isMapDebugEnabled } from '@/lib/maplibre/map-debug'
import type { FlownSite } from '@/features/browse-flown-sites-map/join-flown-sites'
import { buildFlownSitesGeoJSON, type FlownSitesGeoJSON } from './build-flown-sites-geojson'
import { FLOWN_SITES_SOURCE_ID, FLOWN_SITES_LAYER_ID } from './site-layer-ids'

export { FLOWN_SITES_SOURCE_ID, FLOWN_SITES_LAYER_ID }

declare global {
  interface Window {
    // Same mechanism takeoffs-map/index.tsx and track-map.tsx already use — no test runner in
    // this repo drives a real GL context, so scripts/verify-flown-sites.mts needs a handle on
    // the live map to assert source/marker state directly rather than trust a screenshot alone.
    __flownSitesMap?: MapLibreMap
    __flownSitesMapData?: FlownSitesGeoJSON
  }
}

type FlownSitesMapProps = {
  sites: FlownSite[]
  className?: string
}

const DEFAULT_SIZE_CLASSES = 'h-[60vh] w-full'

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function siteBounds(geojson: FlownSitesGeoJSON): LngLatBounds | null {
  if (geojson.features.length === 0) return null
  const first = geojson.features[0]!.geometry.coordinates
  return geojson.features.reduce((bounds, feature) => bounds.extend(feature.geometry.coordinates), new LngLatBounds(first, first))
}

function siteFeatureAt(map: MapLibreMap, event: MapMouseEvent): MapGeoJSONFeature | undefined {
  return map.queryRenderedFeatures(event.point, { layers: [FLOWN_SITES_LAYER_ID] })[0]
}

function pointCoordinates(feature: MapGeoJSONFeature): [number, number] {
  const geometry = feature.geometry as { type: 'Point'; coordinates: [number, number] }
  return geometry.coordinates
}

// Same escape-via-real-DOM-nodes reasoning as takeoffs-map's buildSitePopupContent: a site
// name is upstream flightlog.org content, not something this app controls the shape of.
export function buildFlownSitePopupContent(name: string, flightCount: number): HTMLElement {
  const container = document.createElement('div')
  container.className = 'flex flex-col gap-0.5 text-sm'
  const title = document.createElement('span')
  title.className = 'font-semibold'
  title.textContent = name
  const count = document.createElement('span')
  count.className = 'opacity-70'
  count.textContent = `${flightCount} flight${flightCount === 1 ? '' : 's'}`
  container.append(title, count)
  return container
}

function addSiteMarkers(map: MapLibreMap, geojson: FlownSitesGeoJSON): void {
  if (map.getSource(FLOWN_SITES_SOURCE_ID)) return

  map.addSource(FLOWN_SITES_SOURCE_ID, { type: 'geojson', data: geojson })
  map.addLayer({
    id: FLOWN_SITES_LAYER_ID,
    type: 'circle',
    source: FLOWN_SITES_SOURCE_ID,
    paint: { 'circle-radius': 7, 'circle-color': '#16a34a', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' },
  })
}

function wireSitePopups(map: MapLibreMap): void {
  map.on('click', FLOWN_SITES_LAYER_ID, (event) => {
    const feature = siteFeatureAt(map, event)
    if (!feature) return
    const coordinates = pointCoordinates(feature)
    const name = String(feature.properties?.name ?? '')
    const flightCount = Number(feature.properties?.flightCount ?? 0)
    new Popup().setLngLat(coordinates).setDOMContent(buildFlownSitePopupContent(name, flightCount)).addTo(map)
  })
}

function wireHoverCursor(map: MapLibreMap): void {
  map.on('mouseenter', FLOWN_SITES_LAYER_ID, () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', FLOWN_SITES_LAYER_ID, () => {
    map.getCanvas().style.cursor = ''
  })
}

// #76's flown-sites map: one marker per distinct site a pilot has launched from — deliberately
// simpler than components/takeoffs-map (no clustering, no wind rays, no popup detail link): a
// pilot's own site count is tens, not thousands, and there is no per-country detail page for
// this marker to link to. Mounted only when `sites` is non-empty (see the caller,
// browse-flown-sites-map/index.tsx, for why: an empty map presented as truth is exactly what
// #76's acceptance criteria rule out for the zero-matched-with-unmatched case) — this component
// itself doesn't special-case zero sites, since it is never asked to render that state.
export function FlownSitesMap({ sites, className }: FlownSitesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const geojson = useMemo(() => buildFlownSitesGeoJSON(sites), [sites])

  useEffect(() => {
    const container = containerRef.current
    const bounds = siteBounds(geojson)
    if (!container || mapRef.current || !bounds) return

    const map = new MapLibreMap({
      container,
      style: osmRasterStyle(),
      bounds,
      fitBoundsOptions: { padding: 32, maxZoom: 12 },
    })
    mapRef.current = map

    // See map-debug.ts's own doc comment for why this is a query param, not a NODE_ENV gate.
    if (isMapDebugEnabled()) {
      window.__flownSitesMap = map
      window.__flownSitesMapData = geojson
    }

    map.addControl(new NavigationControl())

    map.on('error', (event) => {
      console.error('[FlownSitesMap]', event.error?.message ?? event)
    })

    const addLayers = () => {
      addSiteMarkers(map, geojson)
      wireSitePopups(map)
      wireHoverCursor(map)
    }

    if (map.isStyleLoaded()) addLayers()
    else map.once('style.load', addLayers)

    return () => {
      map.remove()
      mapRef.current = null
      if (window.__flownSitesMap === map) {
        window.__flownSitesMap = undefined
        window.__flownSitesMapData = undefined
      }
    }
  }, [geojson])

  return <div ref={containerRef} className={classes(className ?? DEFAULT_SIZE_CLASSES, 'overflow-hidden rounded-md')} />
}
