'use client'

import { useEffect, useRef } from 'react'
import {
  LngLatBounds,
  MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type MapOptions,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { TrackPoint } from '@/lib/flightlog/types'

type TrackMapProps = {
  points: TrackPoint[]
  className?: string
}

type MapStyle = NonNullable<MapOptions['style']>

type TrackLineData = {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'LineString'; coordinates: [number, number][] }
    properties: Record<string, never>
  }>
}

const TRACK_SOURCE_ID = 'flight-track'
const TRACK_LAYER_ID = 'flight-track-line'
const DEFAULT_SIZE_CLASSES = 'h-[70vh] w-full'
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

function toLngLat(point: TrackPoint): [number, number] {
  return [point.lon, point.lat]
}

// Built per map instance because MapLibre takes ownership of the style object it is given.
function osmRasterStyle(): MapStyle {
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

function trackLineData(points: TrackPoint[]): TrackLineData {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: points.map(toLngLat) },
        properties: {},
      },
    ],
  }
}

function trackBounds(points: TrackPoint[]): LngLatBounds {
  const first = toLngLat(points[0])
  return points.reduce(
    (bounds, point) => bounds.extend(toLngLat(point)),
    new LngLatBounds(first, first),
  )
}

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function TrackMap({ points, className }: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current || points.length === 0) return

    const map = new MapLibreMap({
      container,
      style: osmRasterStyle(),
      bounds: trackBounds(points),
      fitBoundsOptions: { padding: 48, maxZoom: 14 },
    })
    mapRef.current = map

    map.addControl(new NavigationControl())
    map.addControl(new ScaleControl())

    map.on('error', (event) => {
      console.error('[TrackMap]', event.error?.message ?? event)
    })

    const addTrackLayer = () => {
      if (map.getSource(TRACK_SOURCE_ID)) return
      map.addSource(TRACK_SOURCE_ID, { type: 'geojson', data: trackLineData(points) })
      map.addLayer({
        id: TRACK_LAYER_ID,
        type: 'line',
        source: TRACK_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#2563eb', 'line-width': 3 },
      })
    }

    // An inline style needs no fetch, so it can finish loading before this effect
    // subscribes. Waiting only on the event would silently never add the track.
    if (map.isStyleLoaded()) addTrackLayer()
    else map.once('style.load', addTrackLayer)

    new Marker({ color: '#16a34a' }).setLngLat(toLngLat(points[0])).addTo(map)
    new Marker({ color: '#dc2626' }).setLngLat(toLngLat(points[points.length - 1])).addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [points])

  if (points.length === 0) {
    return (
      <div
        className={classes(
          DEFAULT_SIZE_CLASSES,
          'flex items-center justify-center rounded-md border border-dashed border-black/15 text-sm opacity-60 dark:border-white/20',
          className,
        )}
      >
        No track points
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={classes(DEFAULT_SIZE_CLASSES, 'overflow-hidden rounded-md', className)}
    />
  )
}
