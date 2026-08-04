import { existsSync, readFileSync } from 'node:fs'
import { chromium, type Page } from 'playwright'
import { XMLParser } from 'fast-xml-parser'
import type { GeoJSONSource } from 'maplibre-gl'
import { createReporter } from './lib/verify-report'
import { waitForCondition, waitForMapSettled, waitForPaintIdle } from './lib/verify-settle'
import { SCORING_LINE_COLOR } from '../src/features/show-flight-track/colors'

// #15's scoring overlay, checked against a scene per real flight — each one exercising a
// different absence/degenerate/collision shape — plus one toggle; see docs/testing.md's own
// section on this script for the current scene-by-scene list and why each exists (kept there, not
// re-counted here, so this comment doesn't go stale the next time a scene is added).
// `?__verifyMap` and `pnpm run build && pnpm run start` for the same reason as
// verify-track-gradient.mts/verify-track-hover.mts (#47): the overlay's map source is exactly
// the kind of thing the maplibre-gl v6/Turbopack bug would silently fail to load.
const baseUrl = process.argv[2] ?? 'http://localhost:3000'

const { report, finish } = createReporter()

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })

type RadioState = { label: string; checked: boolean; disabled: boolean }

function trackBadResponses(page: Page): string[] {
  const bad: string[] = []
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
  })
  page.on('requestfailed', (r) => bad.push(`FAILED ${r.failure()?.errorText} ${r.url()}`))
  return bad
}

// The previous version of this wait swallowed both the selector timeout and the evaluate's own
// undefined-map case, so on a page with no map at all (a Suspense skeleton, or a client-side
// navigation error) it resolved immediately and vacuously, reporting settled where nothing had
// actually loaded.
//
// Unlike verify-sites-map.mts's unconditional report(settled, ...), this boolean is only
// reported on the callers' failure paths (loadSceneWithColdServerRetry's error-boundary/retry/
// bad-response branches), never on a clean first load: an unconditional settle line here would
// change the warm-path report output every scene emits, and its absence already unambiguously
// implies settled, since every other path returns before reaching a scene's own assertions.
async function waitForSceneSettled(page: Page): Promise<boolean> {
  const settled = await waitForMapSettled(page, { handle: '__flightTrackMap', sourceId: 'flight-track' })
  if (!settled) return false
  await waitForPaintIdle(page, { handle: '__flightTrackMap', tailMs: 500 })
  return true
}

// data-testid, not the earlier `fieldset label`/`fieldset p` tag selectors: the same PR gives
// turnpoint markers their own data-testid, so the radio options and summary line get one too
// rather than staying the odd ones out.
function readRadios(page: Page): Promise<RadioState[]> {
  return page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('[data-testid="scoring-overlay-option"]'))
    return labels.map((label) => {
      const input = label.querySelector('input[type="radio"]') as HTMLInputElement | null
      return {
        label: label.textContent?.trim() ?? '',
        checked: input?.checked ?? false,
        disabled: input?.disabled ?? false,
      }
    })
  })
}

function readSummary(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.querySelector('[data-testid="scoring-overlay-summary"]')?.textContent ?? null,
  )
}

function readTurnpointMarkerCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-testid="turnpoint-marker"]').length)
}

// #78: a turnpoint marker's own data-label carries its merged label ('D/E') once
// groupTurnpointMarkersByPixelDistance has folded overlapping turnpoints into one badge.
function readTurnpointMarkerLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="turnpoint-marker"]')).map(
      (element) => element.getAttribute('data-label') ?? '',
    ),
  )
}

function readTurnpointMarkerRects(page: Page): Promise<DOMRect[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="turnpoint-marker"]')).map((element) =>
      element.getBoundingClientRect().toJSON(),
    ),
  )
}

type CanvasRect = { x: number; y: number; width: number; height: number }

function readCanvasRect(page: Page): Promise<CanvasRect | null> {
  return page.evaluate(() => {
    const el = document.querySelector('.maplibregl-canvas')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
}

// Two markers with genuinely different coordinates can still sit close enough on screen to
// touch at some zoom levels — this scene is scoped to a known-collision fixture specifically
// so "no two rects intersect" is a real assertion about the merge working, not a flaky one
// about incidental screen proximity elsewhere.
function rectsIntersect(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function anyTwoRectsIntersect(rects: DOMRect[]): boolean {
  return rects.some((rect, index) => rects.some((other, otherIndex) => otherIndex > index && rectsIntersect(rect, other)))
}

async function clickRadioByLabelPrefix(page: Page, prefix: string): Promise<void> {
  await page.evaluate((labelPrefix) => {
    const labels = Array.from(document.querySelectorAll('[data-testid="scoring-overlay-option"]'))
    const target = labels.find((label) => label.textContent?.trim().startsWith(labelPrefix))
    const input = target?.querySelector('input[type="radio"]') as HTMLInputElement | null
    input?.click()
  }, prefix)
}

function pageHasErrorBoundaryText(page: Page): Promise<boolean> {
  return page.evaluate(() => document.body.textContent?.includes('Could not load this from flightlog.org') ?? false)
}

type CanvasColorSample = { distinctColors: number; matchDistance: number }

async function sampleCanvasColors(page: Page, sampleRect: CanvasRect, colorHex: string): Promise<CanvasColorSample> {
  const screenshotBuffer = await page.screenshot()
  const base64 = screenshotBuffer.toString('base64')
  return page.evaluate(
    async ({ base64: b64, rect, targetHex }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const x0 = Math.max(0, Math.floor(rect.x))
      const y0 = Math.max(0, Math.floor(rect.y))
      const x1 = Math.min(canvas.width, Math.ceil(rect.x + rect.width))
      const y1 = Math.min(canvas.height, Math.ceil(rect.y + rect.height))
      const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
      const w = x1 - x0
      const target = [
        Number.parseInt(targetHex.slice(1, 3), 16),
        Number.parseInt(targetHex.slice(3, 5), 16),
        Number.parseInt(targetHex.slice(5, 7), 16),
      ]
      const seen = new Set<string>()
      let minDistance = Infinity
      const step = 3
      for (let y = 0; y < y1 - y0; y += step) {
        for (let x = 0; x < w; x += step) {
          const idx = (y * w + x) * 4
          const r = data[idx]
          const g = data[idx + 1]
          const b = data[idx + 2]
          seen.add(`${r},${g},${b}`)
          const distance = Math.sqrt((r - target[0]) ** 2 + (g - target[1]) ** 2 + (b - target[2]) ** 2)
          if (distance < minDistance) minDistance = distance
        }
      }
      return { distinctColors: seen.size, matchDistance: minDistance }
    },
    { base64, rect: sampleRect, targetHex: colorHex },
  )
}

// getTrack is 'use cache' PER TRIP (cacheLife('days'), tracks.ts), so every scene still pays a
// cold KML fetch of its own. What's actually once-per-process is http.ts's own session mint
// (module-level currentSession), and scene 1 runs first, so it's the one scene that can still
// be racing that mint on top of its own cold fetch: that combination makes it the scene most
// likely to lose the race and come back with the scene never settling, even though nothing is
// actually broken. A transient upstream failure (the session mint or fetch still in flight) is
// deliberately retried once, and by the second load it has normally landed. A deterministic one
// (a real client-side regression, or a genuinely dead server) survives the retry unchanged and
// still fails to settle, same as a page that returns bad responses in `bad`, which is never
// retried away. The signal driving the retry is waitForSceneSettled's own boolean, not the
// radios/summary read (a settled page with a legitimately empty scoring overlay is a real
// state, not a signal to retry). The one signature this retry must not touch is the error
// boundary: getTrack throwing renders error.tsx, which never settles either, but no amount of
// retrying fixes a thrown error, so it is checked for by name before retrying and reported
// explicitly instead.
// Gives the first navigation's still-in-flight getTrack time to land in its 'use cache' entry,
// so the reload is a cache hit.
const COLD_SERVER_RETRY_DELAY_MS = 3000

async function loadSceneWithColdServerRetry(page: Page, url: string, label: string, bad: string[]): Promise<{ radios: RadioState[]; summary: string | null }> {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const settled = await waitForSceneSettled(page)
  if (settled) {
    return { radios: await readRadios(page), summary: await readSummary(page) }
  }
  if (await pageHasErrorBoundaryText(page)) {
    report(false, `${label}: app error boundary rendered ("Could not load this from flightlog.org") instead of the scoring overlay`)
    return { radios: await readRadios(page), summary: await readSummary(page) }
  }
  if (bad.length === 0) {
    console.log(`RETRY - ${label}: the scene did not settle on first load (no map handle, or its flight-track source never finished loading), retrying once for a cold server`)
    await page.waitForTimeout(COLD_SERVER_RETRY_DELAY_MS)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    const settledOnRetry = await waitForSceneSettled(page)
    report(settledOnRetry, `${label}: the scene settles after one cold-server retry (map handle present, flight-track source loaded)`)
    return { radios: await readRadios(page), summary: await readSummary(page) }
  }
  report(false, `${label}: the scene did not settle (no map handle, or its flight-track source never finished loading) and bad responses were recorded`)
  return { radios: await readRadios(page), summary: await readSummary(page) }
}

type SceneContext = { page: Page; radios: RadioState[]; summary: string | null }

// Every scene shares the same open/navigate/close/report-bad-responses skeleton; only the body
// in between (the scene's own assertions) differs. Routing every scene through
// loadSceneWithColdServerRetry (not just scene 1, which needed it) is safe because the retry
// only fires when the scene itself did not settle (no map handle, or its flight-track source
// never finished loading), not on empty-looking-but-settled scoring data; a deterministic
// regression in scenes 2-6 still fails to settle and survives the retry unchanged, so it still
// fails downstream.
async function runScene(options: { tripId: number; label: string; scene: (context: SceneContext) => Promise<void> }): Promise<void> {
  const { tripId, label, scene } = options
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
  const bad = trackBadResponses(page)
  const { radios, summary } = await loadSceneWithColdServerRetry(page, `${baseUrl}/flights/${tripId}?__verifyMap`, label, bad)
  await scene({ page, radios, summary })
  await page.close()
  report(bad.length === 0, `${label}: no unexpected 4xx/5xx responses or failed requests (saw: ${bad.length ? bad.join('; ') : 'none'})`)
}

// === Scene 1: trip 1001428, every geometry available ===================================

// Switching overlays syncs onto the SAME map, not a remount. The 83 new lines in
// track-map.tsx's own scoring-sync effect exist for one documented reason: kept separate from
// the map-creation effect so toggling the overlay doesn't recreate the whole map and reset the
// user's pan/zoom. Nothing before this asserted that path at all; this asserts it directly:
// capture center/zoom, toggle, and check they didn't move, alongside the geometry itself
// actually having changed (different marker count, different summary).
async function assertToggleToFivePointDistance(page: Page, summaryBeforeToggle: string | null): Promise<void> {
  const centerBefore = await page.evaluate(() => {
    const map = window.__flightTrackMap
    return map ? { center: map.getCenter().toArray(), zoom: map.getZoom() } : null
  })

  await clickRadioByLabelPrefix(page, 'Distance over 5 points')
  await page.waitForTimeout(500)

  const centerAfter = await page.evaluate(() => {
    const map = window.__flightTrackMap
    return map ? { center: map.getCenter().toArray(), zoom: map.getZoom() } : null
  })
  const toggledRadios = await readRadios(page)
  const toggledMarkerCount = await readTurnpointMarkerCount(page)
  const toggledLabels = await readTurnpointMarkerLabels(page)
  const toggledSummary = await readSummary(page)

  console.log('center/zoom before toggle:', centerBefore)
  console.log('center/zoom after toggle:', centerAfter)
  console.log('turnpoint markers after toggle:', toggledMarkerCount, toggledLabels)
  console.log('summary after toggle:', toggledSummary)

  report(
    toggledRadios.some((r) => r.label.startsWith('Distance over 5 points') && r.checked),
    'trip 1001428: toggling to the 5-point overlay actually selects it',
  )
  report(
    centerBefore !== null &&
      centerAfter !== null &&
      centerBefore.center[0] === centerAfter.center[0] &&
      centerBefore.center[1] === centerAfter.center[1] &&
      centerBefore.zoom === centerAfter.zoom,
    'trip 1001428: toggling the overlay does not move the map (same center/zoom, so the map was synced onto, not recreated)',
  )
  // Not 5: this flight's own 5-point turnpoints A and B (track_idx 2/233, FsInfo's own 0.91 km
  // apart) project ~16.4px apart at this flight's fit zoom (~9.38) — under the 20px badge, so
  // #83's pixel-distance grouping merges them into one 'A/B' badge here too. This geometry has
  // no exact-coordinate collision at all (#78 never applied to it); the pre-#83 count of 5 was
  // only ever "no two of these five happen to share a coordinate", not "no two of these five
  // are close enough to overlap on screen" — the grouping function is the same one used for
  // every geometry (triangle or line-shaped), so a near pair here merges exactly the way a near
  // pair on a triangle does.
  //
  // The margin on this one is thin: A/B's ~16.4px only needs the fit zoom to climb ~0.29 zoom
  // levels (a ~22% pixel-distance increase) before it clears the 20px threshold and this
  // assertion (and the zoom-reactivity one below) would need a different geometry to hold. The
  // fit zoom itself is not a constant in this file — it falls out of fitBounds(padding: 48)
  // against this scene's own runScene viewport (1400x1200) and the page's layout (max-w-5xl,
  // px-6, the map's own h-[70vh]). A future change to any of those four numbers can legitimately
  // shift the fit zoom enough to flip this merge; if these assertions start failing, check "did
  // the fit zoom move" before assuming #83's grouping regressed.
  report(toggledMarkerCount === 4, `trip 1001428: the 5-point overlay renders 4 turnpoint markers, A and B merged into one near-coordinate badge (got ${toggledMarkerCount})`)
  report(
    toggledLabels.includes('A/B'),
    `trip 1001428: one of the 4 markers carries the merged 'A/B' label (got ${JSON.stringify(toggledLabels)})`,
  )
  report(
    toggledSummary !== null && toggledSummary.startsWith('Distance over 5 points:') && toggledSummary !== summaryBeforeToggle,
    `trip 1001428: the summary actually updated to the newly selected geometry (got "${toggledSummary}")`,
  )
}

// #83's whole point is that grouping is RE-DERIVED on zoom, not computed once at mount and
// frozen forever — nothing before this scene ever changed zoom at all, so track-map.tsx's own
// `map.on('moveend', syncTurnpointGroups)` wiring was unpinned: deleting that one line left
// every other assertion in this file green, because none of them ever drove a zoom change to
// notice grouping had stopped re-deriving. Picks up where assertToggleToFivePointDistance left
// off (5-point geometry selected, A and B merged into one 'A/B' badge at this flight's fit zoom
// ~9.38, per that function's own margin comment above) and zooms in past that ~0.29-zoom-level
// margin to 10, comfortably clearing the 20px badge threshold.
async function assertZoomReactiveTurnpointGrouping(page: Page): Promise<void> {
  await page.evaluate(() => window.__flightTrackMap?.setZoom(10))

  // moveend fires asynchronously (MapLibre settles the camera over at least one render frame),
  // so the DOM read below has to wait for it rather than run immediately after setZoom resolves.
  const separated = await waitForCondition(
    page,
    () =>
      !Array.from(document.querySelectorAll('[data-testid="turnpoint-marker"]')).some(
        (element) => element.getAttribute('data-label') === 'A/B',
      ),
    5000,
  )

  const markerCount = await readTurnpointMarkerCount(page)
  const labels = await readTurnpointMarkerLabels(page)

  console.log('turnpoint markers after zooming to 10:', markerCount, labels)

  report(
    separated,
    `trip 1001428: zooming to 10 re-derives the turnpoint grouping (moveend-driven) and drops the 'A/B' label within 5s (got ${JSON.stringify(labels)})`,
  )
  report(
    markerCount === 5,
    `trip 1001428: at zoom 10, A and B project well past the 20px badge apart, so all five turnpoints render as distinct markers (got ${markerCount})`,
  )
  report(
    !labels.includes('A/B'),
    `trip 1001428: no marker carries the merged 'A/B' label at zoom 10 (got ${JSON.stringify(labels)})`,
  )
}

await runScene({
  tripId: 1001428,
  label: 'trip 1001428',
  scene: async ({ page, radios, summary }) => {
    const sourceLoaded = await page
      .evaluate(() => window.__flightTrackMap?.isSourceLoaded('scoring-overlay') ?? null)
      .catch(() => null)
    const markerCount = await readTurnpointMarkerCount(page)

    console.log('\n=== trip 1001428 (full set) ===')
    console.log('radios:', radios)
    console.log('scoring source loaded:', sourceLoaded)
    console.log('turnpoint markers:', markerCount)
    console.log('summary text:', summary)

    // "Full set" now means the five line-shaped kinds only: track-1001428's own two triangle
    // placemarks are the metadata-only stub (bare <name>, no <description>/<MultiGeometry> — see
    // check-scoring.mts's own assertion against this same fixture), so its triangle radios are
    // CORRECTLY disabled. Asserting "every option enabled" here would either be silently wrong or
    // force the fixture data itself to lie; asserting the true five-enabled/two-disabled split is
    // the real oracle, and #58's own fixtures (trip 233524, below) are what exercise the enabled
    // triangle case this scene no longer can.
    const LINE_LABELS = [
      'Distance over 5 points',
      'Distance over 4 points',
      'Distance over 3 points',
      'Open distance',
      'Out-and-return distance',
    ]
    const TRIANGLE_LABELS = ['Flat triangle', 'FAI triangle']

    report(radios.some((r) => r.label.startsWith('Open distance') && r.checked), 'trip 1001428: Open distance is selected by default')
    report(
      LINE_LABELS.every((label) => radios.find((r) => r.label.startsWith(label))?.disabled === false),
      'trip 1001428: all five line-shaped scoring geometries are enabled',
    )
    report(
      TRIANGLE_LABELS.every((label) => radios.find((r) => r.label.startsWith(label))?.disabled === true),
      'trip 1001428: both triangle placemarks are the metadata-only stub, so both triangle radios are correctly disabled',
    )
    report(sourceLoaded === true, 'trip 1001428: the scoring-overlay map source loaded')
    report(markerCount === 2, `trip 1001428: open distance renders 2 turnpoint markers (got ${markerCount})`)
    report(summary === 'Open distance: 48.95 km', `trip 1001428: the summary shows the geometry's own scored distance (got "${summary}")`)

    // The scoring line's own colour actually appears on the canvas, not just source/layer
    // existence — an existence-only check passes even for a wholly wrong (or empty) geometry, as
    // long as SOME source and layer got added. Sampled the same way verify-shot.mts/
    // verify-track-gradient.mts sample the altitude ramp: crop to the canvas element, decode the
    // screenshot back into pixels, and look for SCORING_LINE_COLOR among them.
    const canvasRect = await readCanvasRect(page)
    if (canvasRect) {
      const { distinctColors, matchDistance } = await sampleCanvasColors(page, canvasRect, SCORING_LINE_COLOR)
      report(distinctColors > 500, `trip 1001428: the canvas is not near-uniform (${distinctColors} distinct sampled colours)`)
      report(
        matchDistance < 40,
        `trip 1001428: the scoring overlay's own colour (${SCORING_LINE_COLOR}) actually appears on the canvas (nearest sampled pixel ${matchDistance.toFixed(1)} away)`,
      )
    } else {
      report(false, 'trip 1001428: .maplibregl-canvas element is present, to know where to sample pixels from')
    }

    await assertToggleToFivePointDistance(page, summary)
    await assertZoomReactiveTurnpointGrouping(page)
  },
})

// === Scene 2: trip 991729, degenerate 5pt/4pt =============================================

await runScene({
  tripId: 991729,
  label: 'trip 991729',
  scene: async ({ radios }) => {
    console.log('\n=== trip 991729 (short flight, degenerate 5pt/4pt) ===')
    console.log('radios:', radios)

    report(
      radios.find((r) => r.label.startsWith('Distance over 5 points'))?.disabled === true,
      'trip 991729: the degenerate 5-point geometry is disabled, not selectable',
    )
    report(
      radios.find((r) => r.label.startsWith('Distance over 4 points'))?.disabled === true,
      'trip 991729: the degenerate 4-point geometry is disabled, not selectable',
    )
    report(
      radios.some((r) => r.label.startsWith('Open distance') && r.checked && !r.disabled),
      'trip 991729: Open distance (not degenerate) is still selected by default',
    )
  },
})

// === Scene 3: trip 235690, out-and-return placemark entirely missing ======================

await runScene({
  tripId: 235690,
  label: 'trip 235690',
  scene: async ({ radios }) => {
    console.log('\n=== trip 235690 (missing out-and-return placemark entirely) ===')
    console.log('radios:', radios)

    report(
      radios.find((r) => r.label.startsWith('Out-and-return distance'))?.disabled === true,
      'trip 235690: the entirely-missing out-and-return placemark is disabled, not selectable',
    )
    report(
      radios.some((r) => r.label.startsWith('Open distance') && r.checked && !r.disabled),
      'trip 235690: Open distance (present) is still selected by default',
    )
  },
})

// === Scene 4: trip 233524, both triangle geometries real — the browser-level oracle for #58's
// render path (scoring-line.ts's scoringLineCoordinates) ===================================
//
// check-scoring.mts pins the PARSE side against this same fixture (exact turnpoint/loop/
// connector indices). Nothing before this scene drove the map's own GeoJSON source and checked
// what actually got drawn — the render half was unpinned entirely: replacing
// scoringLineCoordinates with a naive zigzag straight through turnpointIndices left every
// vitest test and check-scoring.mts assertion green, because neither one ever looks at the
// map's own source data. This scene is what a render-path regression actually has to fail.
//
// The feature-length checks below (one 4-point closed loop, one 2-point connector) catch a
// wrong SHAPE but not a wrong PLACEMENT — a connector drawn over the loop's own points, or vice
// versa, would still be "one 4-point feature, one 2-point feature" and pass. What follows is
// independent of parse-track.ts's own extractTriangleCoordinates/scoringLineCoordinates, the
// same way check-scoring.mts's ownTriangleCoordinates is: it reads the flat triangle
// placemark's own raw MultiGeometry coordinates directly out of the KML text, so the rendered
// features can be checked against the real points, not just the real shape.
const triangleXmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function ownTextValue(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (isRecord(value) && '#text' in value) return ownTextValue(value['#text'])
  return null
}

function parseCoordinatePairs(raw: string): Array<[number, number]> {
  return raw
    .trim()
    .split(/\s+/)
    .map((triple) => {
      const [lon, lat] = triple.split(',').map(Number)
      return [lon, lat] as [number, number]
    })
}

function ownTriangleCoordinates(
  kml: string,
  kind: 'distance_flat_triangle' | 'distance_fai_triangle',
): { loop: Array<[number, number]>; connector: Array<[number, number]> } | null {
  const document = triangleXmlParser.parse(kml) as Record<string, unknown>
  const folder = isRecord(document.Document) ? document.Document.Folder : undefined
  const placemarks = isRecord(folder) ? toArray(folder.Placemark) : []
  const placemark = placemarks.find((p) => isRecord(p) && isRecord(p.Metadata) && p.Metadata['@_type'] === kind)
  if (!isRecord(placemark) || !isRecord(placemark.MultiGeometry)) return null
  const lineStrings = toArray(placemark.MultiGeometry.LineString)
  if (lineStrings.length !== 2) return null
  const [loopRaw, connectorRaw] = lineStrings.map((lineString) =>
    isRecord(lineString) ? ownTextValue(lineString.coordinates) : null,
  )
  if (loopRaw == null || connectorRaw == null) return null
  return { loop: parseCoordinatePairs(loopRaw), connector: parseCoordinatePairs(connectorRaw) }
}

// Rotation-tolerant (a closed loop can legitimately be listed starting at any of its 3 distinct
// vertices) and float-epsilon-tolerant (the rendered points and the placemark's own MultiGeometry
// points are two separately recorded coordinate copies in the same KML) — mirrors
// check-scoring.mts's own isRotationOfOwnCoordinates, not an exact-order/exact-value match.
function isRotationOfOwnCoordinates(rendered: Array<[number, number]>, own: Array<[number, number]>): boolean {
  if (rendered.length !== own.length) return false
  const n = rendered.length
  const EPSILON = 1e-6
  const closeEnough = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON
  for (let rotation = 0; rotation < n; rotation++) {
    if (rendered.every((point, i) => closeEnough(point, own[(i + rotation) % n]))) return true
  }
  return false
}

await runScene({
  tripId: 233524,
  label: 'trip 233524',
  scene: async ({ page, radios }) => {
    console.log('\n=== trip 233524 (real flat/FAI triangle geometries) ===')
    console.log('radios:', radios)

    report(
      radios.find((r) => r.label.startsWith('Flat triangle'))?.disabled === false,
      'trip 233524: the flat triangle is a real, non-degenerate geometry, not disabled',
    )
    report(
      radios.find((r) => r.label.startsWith('FAI triangle'))?.disabled === false,
      'trip 233524: the FAI triangle is a real, non-degenerate geometry, not disabled',
    )

    await clickRadioByLabelPrefix(page, 'Flat triangle')
    await waitForMapSettled(page, { handle: '__flightTrackMap', sourceId: 'scoring-overlay' })
    await waitForPaintIdle(page, { handle: '__flightTrackMap', tailMs: 500 })

    // `source.serialize().data` reads the exact GeoJSON object track-map.tsx's own syncScoringOverlay
    // effect passed to `addSource` — not `querySourceFeatures`, which reads back from the rendered
    // vector tiles instead and, at the low zoom a whole-flight view sits at, quantizes coordinates by
    // as much as a few hundred metres (geojson-vt's own tile-local simplification tolerance). That
    // quantization is invisible to the length/self-closing checks below (they don't care about exact
    // values), but it broke the coordinate-identity check further down outright: real points read
    // back a tenth of a kilometre from where they actually are. Typed loosely (not a `GeoJSON.
    // LineString` cast): `@types/geojson` (the package maplibre-gl's own .d.ts resolves that global
    // namespace against internally) isn't hoisted to this project's top-level node_modules/@types
    // under pnpm, so naming it here would fail typechecking outside maplibre-gl's own module scope.
    const scoringFeatureCoordinates = await page.evaluate(() => {
      const map = window.__flightTrackMap
      if (!map) return null
      const source = map.getSource<GeoJSONSource>('scoring-overlay')
      const data = source?.serialize().data as { features: Array<{ geometry: { type: string; coordinates: unknown } }> } | undefined
      if (!data) return null
      const coordinates: Array<[number, number][]> = []
      for (const feature of data.features) {
        if (feature.geometry.type !== 'LineString') continue
        coordinates.push(feature.geometry.coordinates as [number, number][])
      }
      return coordinates
    })

    console.log('scoring source features (flat triangle):', JSON.stringify(scoringFeatureCoordinates))

    const featuresByLength = [...(scoringFeatureCoordinates ?? [])].sort((a, b) => a.length - b.length)
    const [connector, loop] = featuresByLength

    report(
      scoringFeatureCoordinates !== null && scoringFeatureCoordinates.length === 2,
      `trip 233524: selecting the flat triangle draws exactly two line features on the map's own scoring source (got ${scoringFeatureCoordinates?.length ?? 'none'})`,
    )
    report(
      loop !== undefined && loop.length === 4 && JSON.stringify(loop[0]) === JSON.stringify(loop[3]),
      `trip 233524: one feature is a self-closing 4-coordinate loop, first coordinate repeating last (got ${JSON.stringify(loop)})`,
    )
    report(
      connector !== undefined && connector.length === 2,
      `trip 233524: the other feature is a 2-coordinate connector (got ${JSON.stringify(connector)})`,
    )

    // fixtures/track-233524.kml is gitignored (a scraped copy of the same rqtid=19 KML the app's
    // own server fetched to render this page) — present in a checkout with fixtures regenerated per
    // docs/testing.md, absent otherwise. SKIP (not FAIL) this specific comparison when it's missing,
    // the same convention check-scoring.mts/check-parsers.mts use for the same reason, rather than
    // failing an otherwise-legitimate run over a file this repo deliberately doesn't commit.
    const triangleFixturePath = 'fixtures/track-233524.kml'
    if (existsSync(triangleFixturePath)) {
      const ownFlatTriangle = ownTriangleCoordinates(readFileSync(triangleFixturePath, 'utf8'), 'distance_flat_triangle')
      report(
        ownFlatTriangle !== null && loop !== undefined && isRotationOfOwnCoordinates(loop, ownFlatTriangle.loop),
        `trip 233524: the rendered loop feature's points match the flat triangle placemark's own MultiGeometry loop coordinates, not some other placemark's points (got ${JSON.stringify(loop)}, expected up to rotation ${JSON.stringify(ownFlatTriangle?.loop)})`,
      )
      report(
        ownFlatTriangle !== null && connector !== undefined && isRotationOfOwnCoordinates(connector, ownFlatTriangle.connector),
        `trip 233524: the rendered connector feature's points match the flat triangle placemark's own MultiGeometry connector coordinates, not the loop's (got ${JSON.stringify(connector)}, expected up to rotation ${JSON.stringify(ownFlatTriangle?.connector)})`,
      )
    } else {
      console.log(
        `SKIP - trip 233524: ${triangleFixturePath} absent, skipping the coordinate-identity check against the ` +
          'raw MultiGeometry of the flat triangle placemark (regenerate fixtures per docs/testing.md to exercise it)',
      )
    }
  },
})

// === Scene 5: trip 984290, FAI triangle selected — merged turnpoint markers (#78) ==========
//
// track-984290's own FAI triangle has D and E resolve to the identical track_idx (1215, the
// same array element — see check-scoring.mts's own assertion against this same fixture), so
// its five turnpoints collapse to four distinct coordinates. check-scoring.mts pins the PARSE
// side (turnpointIndices itself still has 5 entries); nothing there ever looks at what the map
// actually draws, so this is the only oracle for the render half — before #78's fix this scene
// would have found 5 stacked markers with the top one hiding the other's letter entirely.

await runScene({
  tripId: 984290,
  label: 'trip 984290',
  scene: async ({ page, radios }) => {
    console.log('\n=== trip 984290 (FAI triangle, shared-endpoint turnpoint collision) ===')
    console.log('radios:', radios)

    report(
      radios.find((r) => r.label.startsWith('FAI triangle'))?.disabled === false,
      'trip 984290: the FAI triangle is a real, non-degenerate geometry, not disabled — asserted before clicking it, so a missing/disabled radio fails here with a clear geometry diagnosis rather than downstream as a misleading marker-count failure',
    )

    await clickRadioByLabelPrefix(page, 'FAI triangle')
    await waitForMapSettled(page, { handle: '__flightTrackMap', sourceId: 'scoring-overlay' })
    await waitForPaintIdle(page, { handle: '__flightTrackMap', tailMs: 500 })

    const markerCount = await readTurnpointMarkerCount(page)
    const letters = await readTurnpointMarkerLabels(page)
    const rects = await readTurnpointMarkerRects(page)

    console.log('turnpoint markers (FAI triangle):', markerCount, letters)

    report(
      markerCount === 4,
      `trip 984290: the FAI triangle's shared-endpoint turnpoints (D/E, same track_idx) render as 4 markers, not 5 stacked ones (got ${markerCount})`,
    )
    report(
      letters.includes('D/E'),
      `trip 984290: one of the 4 markers carries the merged 'D/E' label (got ${JSON.stringify(letters)})`,
    )
    report(
      !anyTwoRectsIntersect(rects),
      `trip 984290: no two turnpoint marker bounding rects intersect (${rects.length} markers checked)`,
    )
  },
})

// === Scene 6: trip 985713, flat triangle selected — merged turnpoint markers, BOTH collision
// shapes on the one fixture (#78 exact-coordinate, #83 near-coordinate) ====================
//
// track-985713's flat triangle (FsInfo track_idx="13 14 157 353 354") hits two different
// turnpoints two different ways: A (track_idx 13) and B (track_idx 14) resolve to the exact
// same coordinate — the #78 case, through two DIFFERENT indices rather than a repeated one the
// way 984290's FAI triangle collides. D (track_idx 353) and E (track_idx 354) are NEVER
// coordinate-equal — they sit ~9.4 m apart, projecting to ~3.55px apart at this flight's fit
// zoom (~13.86) — but that is still well under the 20px badge
// (TURNPOINT_GROUPING_THRESHOLD_PX in track-map.tsx), so
// groupTurnpointMarkersByPixelDistance merges them too (#83). Before #83's fix this scene's own
// D/E pair was the fixture #83 was filed against: two badges sitting close enough to visually
// intersect but never merging, which is exactly what this scene now asserts does NOT happen.

await runScene({
  tripId: 985713,
  label: 'trip 985713',
  scene: async ({ page, radios }) => {
    console.log('\n=== trip 985713 (flat triangle, exact + near turnpoint collisions) ===')
    console.log('radios:', radios)

    report(
      radios.find((r) => r.label.startsWith('Flat triangle'))?.disabled === false,
      'trip 985713: the flat triangle is a real, non-degenerate geometry, not disabled — asserted before clicking it, so a missing/disabled radio fails here with a clear geometry diagnosis rather than downstream as a misleading marker-count failure',
    )

    await clickRadioByLabelPrefix(page, 'Flat triangle')
    await waitForMapSettled(page, { handle: '__flightTrackMap', sourceId: 'scoring-overlay' })
    await waitForPaintIdle(page, { handle: '__flightTrackMap', tailMs: 500 })

    const markerCount = await readTurnpointMarkerCount(page)
    const letters = await readTurnpointMarkerLabels(page)
    const rects = await readTurnpointMarkerRects(page)

    console.log('turnpoint markers (flat triangle):', markerCount, letters)

    report(
      markerCount === 3,
      `trip 985713: the flat triangle's five turnpoints render as 3 markers — A/B (exact-coordinate, #78) and D/E (near-coordinate, #83) each merge, C stays alone (got ${markerCount})`,
    )
    report(
      letters.includes('A/B'),
      `trip 985713: one of the 3 markers carries the exact-coordinate merged 'A/B' label (got ${JSON.stringify(letters)})`,
    )
    report(
      letters.includes('D/E'),
      `trip 985713: one of the 3 markers carries the near-coordinate merged 'D/E' label (got ${JSON.stringify(letters)})`,
    )
    // Same stricter oracle scene 5 uses for 984290: with #83 fixed, D/E no longer legitimately
    // sit un-merged-but-touching — every real collision on this fixture (exact or near) now
    // merges into one badge, so no two rendered badges should intersect at all, not just avoid
    // the exact-same-pixel case the pre-#83 oracle was limited to.
    report(
      !anyTwoRectsIntersect(rects),
      `trip 985713: no two turnpoint marker bounding rects intersect (${rects.length} markers checked)`,
    )
  },
})

await browser.close()

finish('scoring overlay verification')
