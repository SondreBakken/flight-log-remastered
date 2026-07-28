import { useEffect, useRef } from 'react'
import {
  LngLatBounds,
  MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type ExpressionSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { TrackPoint } from '@/lib/flightlog/types'
import { osmRasterStyle } from '@/lib/maplibre/osm-raster-style'
import { isMapDebugEnabled } from '@/lib/maplibre/map-debug'
import { altitudeColorRampCss, buildAltitudeGradient, type GradientStop } from './altitude-color'
import { formatAltitude } from './format-altitude'
import { TRACK_LINE_COLOR } from './colors'
import { nearestIndexByLocation } from './track-hover'

declare global {
  interface Window {
    // See the assignment in the effect below for why this exists.
    __flightTrackMap?: MapLibreMap
  }
}

type TrackMapProps = {
  points: TrackPoint[]
  hoveredIndex: number | null
  onHoverIndex: (index: number | null) => void
  className?: string
}

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

function toLngLat(point: TrackPoint): [number, number] {
  return [point.lon, point.lat]
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

// `line-gradient` is keyed to `line-progress`, MapLibre's own normalised cumulative
// distance along the line. The stop positions built in altitude-color.ts are an
// independent haversine estimate of that same distance, not MapLibre's own projected
// geometry, so they cannot be bit-for-bit identical to it; measured against the real
// fixture the gap is small (worst case ~41 m over a track more than 100 km long) and has
// no visible effect on where a colour lands.
function toLineGradientExpression(stops: GradientStop[]): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    ...stops.flatMap((stop) => [stop.fraction, stop.color]),
  ] as ExpressionSpecification
}

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function TrackMap({ points, hoveredIndex, onHoverIndex, className }: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const hoverMarkerRef = useRef<Marker | null>(null)
  const gradient = buildAltitudeGradient(points)

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
    // No test runner in this repo; browser verification scripts (scripts/verify-track-gradient.mts,
    // scripts/verify-track-hover.mts) drive a real page instead and need a handle on the live map to
    // assert source/layer state programmatically rather than trust a screenshot alone — and, per
    // #47, they have to run against a real `pnpm run build && pnpm run start`, not `next dev`, to
    // catch a bundler-specific failure dev mode is the least likely place to reproduce (see
    // README's maplibre-gl v6/Turbopack note). See src/lib/maplibre/map-debug.ts for why that
    // means an opt-in query param rather than a NODE_ENV gate, which `next start` would strip this
    // from unconditionally. Severity of the residual exposure is low, not zero: this page's
    // `points` array is already serialized to the client for every visitor of this public route
    // (it's how TrackMap gets rendered at all), so the handle reveals nothing the visitor's own
    // browser hadn't already downloaded. Cleared on unmount below so a removed map (its GL
    // context, tile cache, and the point array it closes over) does not stay reachable from
    // `window` after teardown.
    if (isMapDebugEnabled()) {
      window.__flightTrackMap = map
    }

    map.addControl(new NavigationControl())
    map.addControl(new ScaleControl())

    map.on('error', (event) => {
      console.error('[TrackMap]', event.error?.message ?? event)
    })

    const addTrackLayer = () => {
      if (map.getSource(TRACK_SOURCE_ID)) return
      // lineMetrics computes line-progress per vertex, the only per-vertex colour
      // mechanism MapLibre has; GeoJSON `properties` are per feature, not per point.
      map.addSource(TRACK_SOURCE_ID, {
        type: 'geojson',
        data: trackLineData(points),
        lineMetrics: true,
      })
      map.addLayer({
        id: TRACK_LAYER_ID,
        type: 'line',
        source: TRACK_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-gradient': toLineGradientExpression(gradient.stops), 'line-width': 3 },
      })

      // Scoped to the track layer rather than the whole map: MapLibre only calls this
      // handler when the cursor is actually over the rendered line (its own hit-testing
      // against the rendered pixels), so a per-event nearest-point scan over the full
      // ~7000-point track only ever runs while hovering the line, not on every mouse move
      // across the whole viewport.
      map.on('mousemove', TRACK_LAYER_ID, (event) => {
        const index = nearestIndexByLocation(points, event.lngLat.lng, event.lngLat.lat)
        if (index !== null) onHoverIndex(index)
      })
      map.on('mouseenter', TRACK_LAYER_ID, () => {
        map.getCanvas().style.cursor = 'crosshair'
      })
      map.on('mouseleave', TRACK_LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
        onHoverIndex(null)
      })
    }

    // An inline style needs no fetch, so it can finish loading before this effect
    // subscribes. Waiting only on the event would silently never add the track.
    if (map.isStyleLoaded()) addTrackLayer()
    else map.once('style.load', addTrackLayer)

    new Marker({ color: '#16a34a' }).setLngLat(toLngLat(points[0])).addTo(map)
    new Marker({ color: '#dc2626' }).setLngLat(toLngLat(points[points.length - 1])).addTo(map)

    // Created once and hidden, then only ever repositioned/toggled below: adding and
    // removing a marker on every pointer move would thrash the DOM at pointer-move rate
    // and risks racing the start/end markers above.
    const hoverMarker = new Marker({ color: TRACK_LINE_COLOR }).setLngLat(toLngLat(points[0])).addTo(map)
    hoverMarker.getElement().style.display = 'none'
    hoverMarker.getElement().setAttribute('data-testid', 'hover-marker')
    hoverMarkerRef.current = hoverMarker

    return () => {
      map.remove()
      mapRef.current = null
      hoverMarkerRef.current = null
      if (window.__flightTrackMap === map) {
        window.__flightTrackMap = undefined
      }
    }
  }, [points, gradient.stops, onHoverIndex])

  useEffect(() => {
    const hoverMarker = hoverMarkerRef.current
    if (!hoverMarker) return

    // hoveredIndex is a position in this same `points` array (see track-hover.ts's module
    // doc comment), so it resolves directly — no nearest-point search needed on this side.
    const point = hoveredIndex === null ? null : (points[hoveredIndex] ?? null)
    hoverMarker.getElement().style.display = point ? '' : 'none'
    // data-index/data-seconds mirror the barogram's hover indicator (see HoverIndicator in
    // barogram.tsx): both are test hooks that let a browser script confirm the two views
    // agree on the same point, not just that each one changed.
    hoverMarker.getElement().setAttribute('data-index', hoveredIndex === null ? '' : String(hoveredIndex))
    hoverMarker.getElement().setAttribute('data-seconds', point ? String(point.secondsFromStart) : '')
    if (point) hoverMarker.setLngLat(toLngLat(point))
  }, [hoveredIndex, points])

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
    <div className={classes('flex flex-col gap-2', className)}>
      <div
        ref={containerRef}
        className={classes(DEFAULT_SIZE_CLASSES, 'overflow-hidden rounded-md')}
      />
      <AltitudeLegend minAltitude={gradient.minAltitude} maxAltitude={gradient.maxAltitude} />
    </div>
  )
}

function AltitudeLegend({ minAltitude, maxAltitude }: { minAltitude: number; maxAltitude: number }) {
  return (
    <div className="flex items-center gap-2 text-xs opacity-70">
      <span className="tabular-nums">{formatAltitude(minAltitude)}</span>
      <span
        aria-hidden="true"
        className="h-2 flex-1 rounded-full"
        style={{ backgroundImage: altitudeColorRampCss() }}
      />
      <span className="tabular-nums">{formatAltitude(maxAltitude)}</span>
    </div>
  )
}
