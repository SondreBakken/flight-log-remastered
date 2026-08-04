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
import type { ScoringGeometry, TrackPoint } from '@/lib/flightlog/types'
import { osmRasterStyle } from '@/lib/maplibre/osm-raster-style'
import { isMapDebugEnabled } from '@/lib/maplibre/map-debug'
import { altitudeColorRampCss, buildAltitudeGradient, type GradientStop } from './altitude-color'
import { formatAltitude } from './format-altitude'
import { SCORING_LINE_COLOR, TRACK_LINE_COLOR } from './colors'
import { scoringLineCoordinates, toLngLat } from './scoring-line'
import { nearestIndexByLocation } from './track-hover'
import { groupTurnpointMarkersByPixelDistance, turnpointGroupLabel, type TurnpointMarkerGroup } from './turnpoint-markers'

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
  scoringGeometry: ScoringGeometry | null
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
const SCORING_SOURCE_ID = 'scoring-overlay'
const SCORING_LAYER_ID = 'scoring-overlay-line'
const DEFAULT_SIZE_CLASSES = 'h-[70vh] w-full'

// The badge is a 20x20 circle (see createTurnpointElement's own `h-5`/`min-w-5` below), so two
// badge centers less than 20px apart on screen already overlap — that diameter is the natural
// pixel-distance threshold for grouping two turnpoints into one badge (#83).
const TURNPOINT_GROUPING_THRESHOLD_PX = 20

// One Feature per line: a plain track or a line-shaped scoring geometry draws as a single
// entry, a triangle as two (loop, connector — see scoring-line.ts's scoringLineCoordinates).
// A single GeoJSON source/layer renders every feature it's given with the same paint, so two
// features need no second layer of their own.
function lineData(lines: Array<[number, number][]>): TrackLineData {
  return {
    type: 'FeatureCollection',
    features: lines.map((coordinates) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates },
      properties: {},
    })),
  }
}

function trackLineData(points: TrackPoint[]): TrackLineData {
  return lineData([points.map(toLngLat)])
}

// A small badge carrying the turnpoint's own letter (A-E, matching the KML turnpoint table —
// see scoring-overlay.ts's turnpointLetter), or several letters joined ('D/E') when
// groupTurnpointMarkersByPixelDistance has merged overlapping turnpoints into one marker (#78,
// #83). MapLibre's Marker only positions a DOM element it's handed; it has no built-in
// labelled-pin primitive,
// which is why every other marker in this file (start/end/hover) is a plain colour dot and
// this is the first one that needs its own element rather than just a `color` option.
// `min-w-5` (not a fixed `w-5`) with `px-1` lets a merged label's badge grow wide enough not
// to clip, while a single letter stays exactly the same 20x20 circle it always was: its own
// glyph plus padding never exceeds the 20px floor `min-w-5`/`h-5` sets.
function createTurnpointElement(label: string): HTMLDivElement {
  const element = document.createElement('div')
  element.textContent = label
  element.className =
    'flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white px-1 text-[10px] font-semibold text-white shadow'
  element.style.backgroundColor = SCORING_LINE_COLOR
  return element
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

// A cheap identity for "did the grouping actually change" (label plus anchor coordinate, since
// two groups can share a label — e.g. neither exists yet — but never share both), so a zoomend
// that leaves every badge's membership unchanged skips tearing down and re-adding markers.
function turnpointGroupsSignature(groups: TurnpointMarkerGroup[]): string {
  return groups.map((group) => `${turnpointGroupLabel(group)}@${group.point.lon},${group.point.lat}`).join('|')
}

export function TrackMap({ points, hoveredIndex, onHoverIndex, scoringGeometry, className }: TrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const hoverMarkerRef = useRef<Marker | null>(null)
  const turnpointMarkersRef = useRef<Marker[]>([])
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
    // Vitest runs under jsdom, not a real browser (see README's own note on this), so it can't
    // hold a live MapLibre GL instance; browser verification scripts (scripts/verify-track-gradient.mts,
    // scripts/verify-track-hover.mts) drive a real page instead and need a handle on the live map to
    // assert source/layer state programmatically rather than trust a screenshot alone — and, per
    // #47, they have to run against a real `pnpm run build && pnpm run start`, not `next dev`, to
    // catch a bundler-specific failure dev mode is the least likely place to reproduce (see
    // README's maplibre-gl v6/Turbopack note). See src/lib/maplibre/map-debug.ts for why that
    // means an opt-in query param rather than a NODE_ENV gate: `next build` is what inlines
    // NODE_ENV and lets the bundler eliminate a dead branch, so a NODE_ENV-gated handle would
    // never survive into the very build these scripts exist to test. Severity of the residual
    // exposure is low, not zero: unlike a data-only handle, this one hands out a live map
    // instance, i.e. scripted control of the map and its GL context, not just a snapshot — but
    // reaching it at all already requires the same arbitrary script execution on the page that
    // this query param doesn't meaningfully raise or lower (see takeoffs-map.tsx's own comment),
    // and this page's `points` array is already serialized to the client for every visitor of
    // this public route (it's how TrackMap gets rendered at all), so the handle reveals no DATA
    // the visitor's own browser hadn't already downloaded. Cleared on unmount below so a removed
    // map (its GL context, tile cache, and the point array it closes over) does not stay
    // reachable from `window` after teardown.
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

  // Kept separate from the map-creation effect above rather than folded into it: that effect
  // tears down and recreates the whole map (controls, hover listeners, camera position) on
  // every dependency change, which would make toggling the scoring overlay reset the user's
  // pan/zoom. This effect instead only ever adds/replaces/removes one source, one layer and a
  // handful of markers on an already-live map — the same "sync onto the existing map" shape
  // the hoveredIndex effect above uses for the hover marker.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Reset per effect run (mirrors turnpointMarkersRef, which this closure over `map` also
    // owns exclusively for the run's lifetime): a fresh scoringGeometry/points always means a
    // fresh sync, never a stale signature from the previous run suppressing the first render.
    let turnpointGroupSignature: string | null = null

    const renderTurnpointGroups = (groups: TurnpointMarkerGroup[]) => {
      turnpointMarkersRef.current.forEach((marker) => marker.remove())
      turnpointMarkersRef.current = groups.map((group) => {
        const label = turnpointGroupLabel(group)
        const marker = new Marker({ element: createTurnpointElement(label) })
          .setLngLat(toLngLat(group.point))
          .addTo(map)
        marker.getElement().setAttribute('data-testid', 'turnpoint-marker')
        marker.getElement().setAttribute('data-label', label)
        return marker
      })
    }

    // Re-derives which turnpoints overlap at the CURRENT zoom and only touches the DOM when
    // that answer actually changed (#83): re-adding bit-identical markers on every zoomend
    // would tear down and recreate every badge (and its hover/DOM state) for gestures that
    // never crossed a grouping boundary at all.
    const syncTurnpointGroups = () => {
      if (!scoringGeometry) return
      const groups = groupTurnpointMarkersByPixelDistance(
        scoringGeometry.turnpointIndices,
        points,
        (point) => map.project(toLngLat(point)),
        TURNPOINT_GROUPING_THRESHOLD_PX,
      )
      const signature = turnpointGroupsSignature(groups)
      if (signature === turnpointGroupSignature) return
      turnpointGroupSignature = signature
      renderTurnpointGroups(groups)
    }

    const syncScoringOverlay = () => {
      turnpointMarkersRef.current.forEach((marker) => marker.remove())
      turnpointMarkersRef.current = []
      turnpointGroupSignature = null
      if (map.getLayer(SCORING_LAYER_ID)) map.removeLayer(SCORING_LAYER_ID)
      if (map.getSource(SCORING_SOURCE_ID)) map.removeSource(SCORING_SOURCE_ID)

      if (!scoringGeometry) return

      map.addSource(SCORING_SOURCE_ID, {
        type: 'geojson',
        data: lineData(scoringLineCoordinates(scoringGeometry, points)),
      })
      map.addLayer({
        id: SCORING_LAYER_ID,
        type: 'line',
        source: SCORING_SOURCE_ID,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': SCORING_LINE_COLOR, 'line-width': 3, 'line-dasharray': [2, 1.5] },
      })

      // turnpointIndices are positions in this same `points` array (see types.ts's
      // ScoringGeometry doc comment) — resolved directly, no matching needed. Markers use
      // every turnpoint in its own A-E order regardless of shape; the drawn line does not
      // (see scoringLineCoordinates) because a triangle's loop and connector are not one
      // continuous path through that same order. Two or more turnpoints can render close
      // enough on screen to overlap their 20px badges — through an exact shared coordinate
      // (#78 — a repeated index, or two different indices resolving to the same point) or
      // merely near-identical ones a few metres apart (#83) — so
      // groupTurnpointMarkersByPixelDistance folds those into one marker with a combined label
      // rather than stacking overlapping badges on top of each other.
      syncTurnpointGroups()
    }

    if (map.isStyleLoaded()) syncScoringOverlay()
    else map.once('style.load', syncScoringOverlay)

    // Pixel distance between two fixed geo points is invariant under pan — only a zoom change
    // rescales the projection between them — so only 'zoomend' is wired here, the same
    // settled-gesture precedent takeoffs-map.tsx's wireRayRescaling uses, and no pan/move
    // listener is needed at all.
    map.on('zoomend', syncTurnpointGroups)

    return () => {
      // `once` self-removes after firing, but never fires at all if this effect's cleanup
      // runs first (unmounting, or scoringGeometry/points changing again, while the style is
      // still loading) — `off` is what stops that listener outliving the run that added it,
      // mirroring the addTrackLayer effect above's own `style.load` subscription.
      map.off('style.load', syncScoringOverlay)
      map.off('zoomend', syncTurnpointGroups)
      turnpointMarkersRef.current.forEach((marker) => marker.remove())
      turnpointMarkersRef.current = []
    }
  }, [scoringGeometry, points])

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
