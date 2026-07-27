import { chromium } from 'playwright'

// Headless, never the Chrome extension: an unfocused extension window pauses
// requestAnimationFrame, which would make a real hover interaction silently never resolve
// (see verify-track-gradient.mts, and issue #21 for why a screenshot alone is not
// evidence). This drives real pointer input and asserts on live DOM/map state.
const url = process.argv[2] ?? 'http://localhost:3005/flights/1001428'
const out = process.argv[3] ?? 'verify-track-hover.png'

// A marker rendered many kilometres away on a real flight track projects to a screen
// position many hundreds of pixels off; this tolerance is generous for anchor/rendering
// slop while staying far tighter than that, so a marker parked at the wrong point still
// fails clearly.
const PIXEL_TOLERANCE_PX = 60
// The barogram can only ever draw one of its own ~400 downsampled points, so its indicator
// generally lands on the nearest SURVIVING sample in time, not the exact hovered instant.
// This tolerance is generous against that decimation gap while staying far tighter than a
// gross mismatch (e.g. a 20-minute/1200s offset) would need to slip under.
const SECONDS_TOLERANCE = 180

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
const logs: string[] = []
const bad: string[] = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`))
page.on('response', (r) => {
  if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
})
page.on('requestfailed', (r) => bad.push(`FAILED ${r.failure()?.errorText} ${r.url()}`))

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 }).catch(() => {})
await page
  .waitForFunction(() => window.__flightTrackMap?.isSourceLoaded('flight-track') === true, { timeout: 20000 })
  .catch(() => {})
await page.waitForTimeout(1000)

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

async function markerState() {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="hover-marker"]') as HTMLElement | null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      display: el.style.display,
      seconds: el.getAttribute('data-seconds'),
      index: el.getAttribute('data-index'),
    }
  })
}

async function projectedPixel(coordinate: [number, number]) {
  return page.evaluate((coord) => {
    const map = window.__flightTrackMap
    if (!map) return null
    const projected = map.project(coord as [number, number])
    const rect = map.getCanvas().getBoundingClientRect()
    return { x: rect.left + projected.x, y: rect.top + projected.y }
  }, coordinate)
}

async function aRealCoordinateOnTheLine(): Promise<[number, number] | null> {
  // Only used to pick SOME real pixel on the rendered line to click; not used to infer any
  // full-track index or elapsed time from its position, since MapLibre's querySourceFeatures
  // returns a tile-simplified geometry (fewer, decimated vertices), not the original
  // full-resolution coordinate array the app's `points` holds.
  return page.evaluate(() => {
    const map = window.__flightTrackMap
    if (!map) return null
    const features = map.querySourceFeatures('flight-track')
    const line = features.find((f) => f.geometry.type === 'LineString')
    if (!line || line.geometry.type !== 'LineString') return null
    const coordinates = line.geometry.coordinates as [number, number][]
    return coordinates[Math.floor(coordinates.length * 0.82)] ?? null
  })
}

async function readIndicator() {
  return page.evaluate(() => {
    const indicator = document.querySelector('[data-testid="barogram-hover-indicator"]')
    return {
      present: !!indicator,
      seconds: indicator?.getAttribute('data-seconds') ?? null,
      altitude: indicator?.getAttribute('data-altitude') ?? null,
      index: indicator?.getAttribute('data-index') ?? null,
    }
  })
}

// --- direction 1: hovering a point on the MAP marks the SAME point on the chart ---
// The target pixel is chosen from the map's own rendered geometry (a real point on the
// line, independent of any hover/nearest-point search); the map marker's ACTUAL on-screen
// position is then checked against that pixel directly (proving the map itself is
// accurate), and the marker's and the chart indicator's own reported elapsed seconds — each
// read from the DOM, not assumed — are checked against EACH OTHER (proving the two views
// agree), not against a value either check invents.

const mapHoverCoordinate = await aRealCoordinateOnTheLine()
const mapHoverTargetPixel = mapHoverCoordinate ? await projectedPixel(mapHoverCoordinate) : null
if (!mapHoverCoordinate || !mapHoverTargetPixel) {
  console.error('FAIL - could not resolve a real screen pixel on the rendered track line')
  await browser.close()
  process.exit(1)
}

// A couple of small moves around the exact projected pixel, since MapLibre's line
// hit-testing wants the cursor within the rendered stroke width, not just near it.
await page.mouse.move(mapHoverTargetPixel.x - 3, mapHoverTargetPixel.y - 3)
await page.mouse.move(mapHoverTargetPixel.x, mapHoverTargetPixel.y, { steps: 4 })
await page.mouse.move(mapHoverTargetPixel.x + 1, mapHoverTargetPixel.y, { steps: 2 })
await page.waitForTimeout(300)

const mapHoverMarker = await markerState()
const mapHoverIndicator = await readIndicator()
const mapHoverExpectedPixel = await projectedPixel(mapHoverCoordinate)

const mapHoverMarkerDistancePx =
  mapHoverMarker && mapHoverExpectedPixel ? distance(mapHoverMarker.center, mapHoverExpectedPixel) : Infinity
const mapHoverSecondsGap =
  mapHoverMarker?.seconds && mapHoverIndicator.seconds
    ? Math.abs(Number(mapHoverMarker.seconds) - Number(mapHoverIndicator.seconds))
    : Infinity

const mapHoverOk =
  mapHoverMarker?.display !== 'none' &&
  mapHoverIndicator.present &&
  mapHoverMarkerDistancePx <= PIXEL_TOLERANCE_PX &&
  mapHoverSecondsGap <= SECONDS_TOLERANCE

console.log('map hover: target pixel (a real point on the rendered line)', mapHoverTargetPixel)
console.log('map hover: marker actual', mapHoverMarker, '| expected pixel', mapHoverExpectedPixel, '| distance px', mapHoverMarkerDistancePx)
console.log('map hover: chart indicator', mapHoverIndicator, '| seconds gap vs marker', mapHoverSecondsGap)
console.log('map -> chart hover ok:', mapHoverOk)

// --- direction 2: hovering the CHART marks the SAME point on the map ---
// The "expected seconds" (half the flight duration) is read from the SVG's own static
// aria-valuemax, a scale property independent of any hover/nearest-point search. The chart
// indicator's and the map marker's own reported elapsed seconds are then checked against
// both that value and each other.

await page.mouse.move(50, 50)
await page.waitForTimeout(200)

const chartScale = await page.evaluate(() => {
  const svg = document.querySelector('svg[role="slider"]')
  if (!svg) return null
  const rect = svg.getBoundingClientRect()
  return {
    maxSeconds: Number(svg.getAttribute('aria-valuemax')),
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
})
if (!chartScale || !Number.isFinite(chartScale.maxSeconds)) {
  console.error('FAIL - could not read the barogram scale (svg[role="slider"] aria-valuemax)')
  await browser.close()
  process.exit(1)
}

const chartHoverExpectedSeconds = chartScale.maxSeconds * 0.5
const chartHoverPixel = { x: chartScale.left + chartScale.width * 0.5, y: chartScale.top + chartScale.height * 0.5 }

await page.mouse.move(chartHoverPixel.x, chartHoverPixel.y)
await page.mouse.move(chartHoverPixel.x + 1, chartHoverPixel.y, { steps: 2 })
await page.waitForTimeout(200)

const chartHoverIndicator = await readIndicator()
const chartHoverMarker = await markerState()

const chartHoverExpectedGap =
  chartHoverIndicator.seconds !== null ? Math.abs(Number(chartHoverIndicator.seconds) - chartHoverExpectedSeconds) : Infinity
const chartHoverCrossViewGap =
  chartHoverIndicator.seconds && chartHoverMarker?.seconds
    ? Math.abs(Number(chartHoverIndicator.seconds) - Number(chartHoverMarker.seconds))
    : Infinity

const chartHoverOk =
  chartHoverIndicator.present &&
  chartHoverIndicator.altitude !== null &&
  chartHoverMarker?.display !== 'none' &&
  chartHoverExpectedGap <= SECONDS_TOLERANCE &&
  chartHoverCrossViewGap <= SECONDS_TOLERANCE

console.log('chart hover: expected seconds (50% of duration)', chartHoverExpectedSeconds)
console.log('chart hover: indicator', chartHoverIndicator, '| gap vs expected', chartHoverExpectedGap)
console.log('chart hover: map marker', chartHoverMarker, '| gap vs chart indicator', chartHoverCrossViewGap)
console.log('chart -> map hover ok:', chartHoverOk)

// --- pointer leaving either view clears hover state on both ---

await page.mouse.move(50, 50)
await page.waitForTimeout(300)

const clearedAssertion = await page.evaluate(() => {
  const indicator = document.querySelector('[data-testid="barogram-hover-indicator"]')
  const marker = document.querySelector('[data-testid="hover-marker"]') as HTMLElement | null
  return { indicatorPresent: !!indicator, markerDisplay: marker?.style.display ?? null }
})
const clearedOk = !clearedAssertion.indicatorPresent && clearedAssertion.markerDisplay === 'none'
console.log('cleared-on-leave assertion:', clearedAssertion, '| ok:', clearedOk)

// --- keyboard users can drive the same shared hover state via the barogram: ArrowRight
// steps by one point, End jumps straight to the last point (see barogram.tsx's stepIndex) ---

await page.locator('svg[role="slider"]').focus()
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(150)

const firstArrow = await readIndicator()

await page.keyboard.press('ArrowRight')
await page.waitForTimeout(150)

const secondArrow = await readIndicator()

await page.keyboard.press('End')
await page.waitForTimeout(150)

const endKey = await readIndicator()

const keyboardOk =
  firstArrow.seconds !== null &&
  secondArrow.seconds !== null &&
  Number(secondArrow.seconds) > Number(firstArrow.seconds) &&
  endKey.seconds !== null &&
  Number(endKey.seconds) > Number(secondArrow.seconds)

console.log('keyboard hover assertion:', { firstArrow, secondArrow, endKey }, '| ok:', keyboardOk)

console.log('bad responses:', bad.length ? bad : 'none')
console.log('logs:', logs.length ? logs : 'none')
await page.screenshot({ path: out })
await browser.close()

if (!mapHoverOk || !chartHoverOk || !clearedOk || !keyboardOk) {
  console.error('FAIL - track hover sync assertion did not pass')
  process.exit(1)
}
console.log('PASS - track hover sync assertion passed')
