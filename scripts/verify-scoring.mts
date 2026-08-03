import { existsSync, readFileSync } from 'node:fs'
import { chromium, type Page } from 'playwright'
import { XMLParser } from 'fast-xml-parser'
import type { GeoJSONSource } from 'maplibre-gl'
import { createReporter } from './lib/verify-report'
import { SCORING_LINE_COLOR } from '../src/features/show-flight-track/colors'

// #15's scoring overlay, checked against a scene per real flight — each one exercising a
// different absence/degenerate/collision shape — plus one toggle; see README's own section on
// this script for the current scene-by-scene list and why each exists (kept there, not
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

async function waitForMapIdle(page: Page): Promise<void> {
  await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 }).catch(() => {})
  await page
    .evaluate(
      () =>
        new Promise<void>((resolve) => {
          const map = window.__flightTrackMap
          if (!map || map.loaded()) return resolve()
          map.once('idle', () => resolve())
          setTimeout(resolve, 15000)
        }),
    )
    .catch(() => {})
  await page.waitForTimeout(500)
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
// groupTurnpointMarkers has folded co-located turnpoints into one badge.
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

// Exact position, not intersection: two markers projected from the identical lon/lat resolve
// to the identical screen pixel deterministically, so exact equality (not a distance
// tolerance) is the real oracle for "the merge still works" — and it stays immune to #83's
// near-identical-but-distinct pairs (measured 3.6 px and 0.7 px apart), which are legitimately
// close but never bit-for-bit equal.
function rectsAtSamePosition(a: DOMRect, b: DOMRect): boolean {
  return a.left === b.left && a.top === b.top
}

function anyTwoRectsAtSamePosition(rects: DOMRect[]): boolean {
  return rects.some((rect, index) => rects.some((other, otherIndex) => otherIndex > index && rectsAtSamePosition(rect, other)))
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

// getTrack is 'use cache' PER TRIP (cacheLife('days'), tracks.ts), so every scene still pays a
// cold KML fetch of its own. What's actually once-per-process is http.ts's own session mint
// (module-level currentSession), and scene 1 runs first, so it's the one scene that can still
// be racing that mint on top of its own cold fetch: that combination makes it the scene most
// likely to lose the race and come back with radios: [] and summary: null even though nothing
// is actually broken. A transient upstream failure (the session mint or fetch still in flight)
// is deliberately retried once, and by the second read it has normally landed. A deterministic
// one (a real client-side regression) survives the retry unchanged and fails downstream, same
// as a page that returns bad responses in `bad`, which is never retried away. The one signature
// this retry must not touch is the error boundary: getTrack throwing renders error.tsx with the
// byte-identical empty signature, but no amount of retrying fixes a thrown error, so it is
// checked for by name before retrying and reported explicitly instead.
// Gives the first navigation's still-in-flight getTrack time to land in its 'use cache' entry,
// so the reload is a cache hit.
const COLD_SERVER_RETRY_DELAY_MS = 3000

async function loadSceneWithColdServerRetry(page: Page, url: string, label: string, bad: string[]): Promise<{ radios: RadioState[]; summary: string | null }> {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await waitForMapIdle(page)
  const radios = await readRadios(page)
  const summary = await readSummary(page)
  if (radios.length === 0 && summary === null && bad.length === 0) {
    if (await pageHasErrorBoundaryText(page)) {
      report(false, `${label}: app error boundary rendered ("Could not load this from flightlog.org") instead of the scoring overlay`)
      return { radios, summary }
    }
    console.log(`RETRY - ${label}: empty radios + null summary + no bad responses on first read, retrying once for a cold server`)
    await page.waitForTimeout(COLD_SERVER_RETRY_DELAY_MS)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await waitForMapIdle(page)
    return { radios: await readRadios(page), summary: await readSummary(page) }
  }
  return { radios, summary }
}

type SceneContext = { page: Page; radios: RadioState[]; summary: string | null }

// Every scene shares the same open/navigate/close/report-bad-responses skeleton; only the body
// in between (the scene's own assertions) differs. Routing every scene through
// loadSceneWithColdServerRetry (not just scene 1, which needed it) is safe because the retry
// only fires on the exact cold-empty signature documented above (empty radios, null summary,
// no bad responses, no error boundary); a deterministic regression in scenes 2-6 still trips
// that signature and survives the retry unchanged, so it still fails downstream.
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
    const canvasRect = await page.evaluate(() => {
      const el = document.querySelector('.maplibregl-canvas')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    if (canvasRect) {
      const screenshotBuffer = await page.screenshot()
      const base64 = screenshotBuffer.toString('base64')
      const { distinctColors, matchDistance } = await page.evaluate(
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
        { base64, rect: canvasRect, targetHex: SCORING_LINE_COLOR },
      )
      report(distinctColors > 500, `trip 1001428: the canvas is not near-uniform (${distinctColors} distinct sampled colours)`)
      report(
        matchDistance < 40,
        `trip 1001428: the scoring overlay's own colour (${SCORING_LINE_COLOR}) actually appears on the canvas (nearest sampled pixel ${matchDistance.toFixed(1)} away)`,
      )
    } else {
      report(false, 'trip 1001428: .maplibregl-canvas element is present, to know where to sample pixels from')
    }

    // === Toggle: switching overlays syncs onto the SAME map, not a remount =================
    //
    // The 83 new lines in track-map.tsx's own scoring-sync effect exist for one documented
    // reason: kept separate from the map-creation effect so toggling the overlay doesn't recreate
    // the whole map and reset the user's pan/zoom. Nothing before this asserted that path at all
    // — this does, directly: capture center/zoom, toggle, and check they didn't move, alongside
    // the geometry itself actually having changed (different marker count, different summary).
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
    const toggledSummary = await readSummary(page)

    console.log('center/zoom before toggle:', centerBefore)
    console.log('center/zoom after toggle:', centerAfter)
    console.log('turnpoint markers after toggle:', toggledMarkerCount)
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
    report(toggledMarkerCount === 5, `trip 1001428: the 5-point overlay renders 5 turnpoint markers, not the 2-marker open-distance leftovers (got ${toggledMarkerCount})`)
    report(
      toggledSummary !== null && toggledSummary.startsWith('Distance over 5 points:') && toggledSummary !== summary,
      `trip 1001428: the summary actually updated to the newly selected geometry (got "${toggledSummary}")`,
    )
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
    await page
      .waitForFunction(() => window.__flightTrackMap?.isSourceLoaded('scoring-overlay') === true, { timeout: 20000 })
      .catch(() => {})
    await waitForMapIdle(page)

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
    // the README, absent otherwise. SKIP (not FAIL) this specific comparison when it's missing,
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
          'raw MultiGeometry of the flat triangle placemark (regenerate fixtures per the README to exercise it)',
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
    await page
      .waitForFunction(() => window.__flightTrackMap?.isSourceLoaded('scoring-overlay') === true, { timeout: 20000 })
      .catch(() => {})
    await waitForMapIdle(page)

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

// === Scene 6: trip 985713, flat triangle selected — merged turnpoint markers, the OTHER
// collision shape (#78) =====================================================================
//
// track-985713's flat triangle hits the same physical point through two DIFFERENT indices
// (A at track_idx 13, B at track_idx 14) that independently resolve to the identical
// coordinate, rather than a repeated index the way 984290's FAI triangle does — the case
// groupTurnpointMarkers's own coordinate-keyed (not index-keyed) grouping exists for.

await runScene({
  tripId: 985713,
  label: 'trip 985713',
  scene: async ({ page, radios }) => {
    console.log('\n=== trip 985713 (flat triangle, distinct-index/equal-coordinate turnpoint collision) ===')
    console.log('radios:', radios)

    report(
      radios.find((r) => r.label.startsWith('Flat triangle'))?.disabled === false,
      'trip 985713: the flat triangle is a real, non-degenerate geometry, not disabled — asserted before clicking it, so a missing/disabled radio fails here with a clear geometry diagnosis rather than downstream as a misleading marker-count failure',
    )

    await clickRadioByLabelPrefix(page, 'Flat triangle')
    await page
      .waitForFunction(() => window.__flightTrackMap?.isSourceLoaded('scoring-overlay') === true, { timeout: 20000 })
      .catch(() => {})
    await waitForMapIdle(page)

    const markerCount = await readTurnpointMarkerCount(page)
    const letters = await readTurnpointMarkerLabels(page)
    const rects = await readTurnpointMarkerRects(page)

    console.log('turnpoint markers (flat triangle):', markerCount, letters)

    report(
      markerCount === 4,
      `trip 985713: the flat triangle's shared-coordinate turnpoints (A/B, different track_idx) render as 4 markers, not 5 stacked ones (got ${markerCount})`,
    )
    report(
      letters.includes('A/B'),
      `trip 985713: one of the 4 markers carries the merged 'A/B' label (got ${JSON.stringify(letters)})`,
    )
    // The rect-INTERSECTION oracle (like scene 5's) is deliberately not used here: this same
    // fixture's D and E turnpoints are a NEAR-identical pair (~9.4 m apart, ~3.6 px at this
    // flight's fit zoom 13.86 — not an exact coordinate match) that #83 explicitly scopes out of
    // this fix, and their badges legitimately sit close enough on screen to intersect. Exact
    // SAME-POSITION is still a real, precise oracle: it fails only if the merge itself broke and
    // produced two markers on the identical pixel, which D/E's mere proximity can never trigger.
    report(
      !anyTwoRectsAtSamePosition(rects),
      `trip 985713: no two turnpoint marker bounding rects sit at the exact same screen position (${rects.length} markers checked)`,
    )
  },
})

await browser.close()

finish('scoring overlay verification')
