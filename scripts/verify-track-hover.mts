import { chromium } from 'playwright'

// Headless, never the Chrome extension: an unfocused extension window pauses
// requestAnimationFrame, which would make a real hover interaction silently never resolve
// (see verify-track-gradient.mts, and issue #21 for why a screenshot alone is not
// evidence). This drives real pointer input and asserts on live DOM/map state.
const url = process.argv[2] ?? 'http://localhost:3005/flights/1001428'
const out = process.argv[3] ?? 'verify-track-hover.png'

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

// --- direction 1: hovering the barogram marks the position on the map ---

const chartHoverPixel = await page.evaluate(() => {
  const svg = document.querySelector('svg[role="img"]')
  if (!(svg instanceof SVGSVGElement)) return null
  const rect = svg.getBoundingClientRect()
  return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 }
})

const hoverMarkerBefore = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="hover-marker"]') as HTMLElement | null
  return { display: el?.style.display ?? null, transform: el?.style.transform ?? null }
})

if (chartHoverPixel === null) {
  console.error('FAIL - could not locate the barogram SVG to hover')
  await browser.close()
  process.exit(1)
}

await page.mouse.move(chartHoverPixel.x, chartHoverPixel.y)
await page.mouse.move(chartHoverPixel.x + 1, chartHoverPixel.y, { steps: 2 })
await page.waitForTimeout(200)

const chartHoverAssertion = await page.evaluate(() => {
  const indicator = document.querySelector('[data-testid="barogram-hover-indicator"]')
  const announcement = document.querySelector('[data-testid="barogram-hover-announcement"]')?.textContent ?? ''
  const marker = document.querySelector('[data-testid="hover-marker"]') as HTMLElement | null
  return {
    indicatorPresent: !!indicator,
    seconds: indicator?.getAttribute('data-seconds') ?? null,
    announcement,
    markerDisplay: marker?.style.display ?? null,
    markerTransform: marker?.style.transform ?? null,
  }
})

const chartHoverOk =
  chartHoverAssertion.indicatorPresent &&
  chartHoverAssertion.announcement.length > 0 &&
  chartHoverAssertion.markerDisplay !== 'none' &&
  chartHoverAssertion.markerTransform !== hoverMarkerBefore.transform

console.log('chart -> map hover-marker before:', hoverMarkerBefore)
console.log('chart -> map hover assertion:', chartHoverAssertion, '| ok:', chartHoverOk)

// --- direction 2: hovering the map marks the point on the chart ---

// Move away from the chart first so its own hover state can't bleed into this assertion.
await page.mouse.move(50, 50)
await page.waitForTimeout(200)

const trackPixel = await page.evaluate(() => {
  const map = window.__flightTrackMap
  if (!map) return null
  const features = map.querySourceFeatures('flight-track')
  const line = features.find((f) => f.geometry.type === 'LineString')
  if (!line || line.geometry.type !== 'LineString') return null
  const coordinates = line.geometry.coordinates
  const midpoint = coordinates[Math.floor(coordinates.length / 2)] as [number, number]
  const projected = map.project(midpoint)
  const canvas = map.getCanvas()
  const rect = canvas.getBoundingClientRect()
  return { x: rect.left + projected.x, y: rect.top + projected.y, lngLat: midpoint }
})

if (!trackPixel) {
  console.error('FAIL - could not resolve a screen pixel on the rendered track line')
  await browser.close()
  process.exit(1)
}

const chartHoverBefore = await page.evaluate(() => ({
  present: !!document.querySelector('[data-testid="barogram-hover-indicator"]'),
}))

// A couple of small moves around the exact projected pixel, since MapLibre's line
// hit-testing wants the cursor within the rendered stroke width, not just near it.
await page.mouse.move(trackPixel.x - 3, trackPixel.y - 3)
await page.mouse.move(trackPixel.x, trackPixel.y, { steps: 4 })
await page.mouse.move(trackPixel.x + 1, trackPixel.y, { steps: 2 })
await page.waitForTimeout(300)

const mapHoverAssertion = await page.evaluate(() => {
  const indicator = document.querySelector('[data-testid="barogram-hover-indicator"]')
  const announcement = document.querySelector('[data-testid="barogram-hover-announcement"]')?.textContent ?? ''
  const marker = document.querySelector('[data-testid="hover-marker"]') as HTMLElement | null
  return {
    indicatorPresent: !!indicator,
    seconds: indicator?.getAttribute('data-seconds') ?? null,
    announcement,
    markerDisplay: marker?.style.display ?? null,
  }
})

const mapHoverOk =
  mapHoverAssertion.indicatorPresent && mapHoverAssertion.announcement.length > 0 && mapHoverAssertion.markerDisplay !== 'none'

console.log('map -> chart hover before:', chartHoverBefore)
console.log('map -> chart hover assertion:', mapHoverAssertion, '| ok:', mapHoverOk)

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

// --- keyboard users can drive the same shared hover state via the barogram ---

await page.locator('svg[role="img"]').focus()
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(150)

const keyboardAssertion = await page.evaluate(() => {
  const indicator = document.querySelector('[data-testid="barogram-hover-indicator"]')
  const marker = document.querySelector('[data-testid="hover-marker"]') as HTMLElement | null
  return {
    seconds: indicator?.getAttribute('data-seconds') ?? null,
    markerDisplay: marker?.style.display ?? null,
  }
})
const firstArrowSeconds = keyboardAssertion.seconds

await page.keyboard.press('ArrowRight')
await page.waitForTimeout(150)

const keyboardAdvancedAssertion = await page.evaluate(() => {
  const indicator = document.querySelector('[data-testid="barogram-hover-indicator"]')
  return { seconds: indicator?.getAttribute('data-seconds') ?? null }
})

const keyboardOk =
  keyboardAssertion.markerDisplay !== 'none' &&
  firstArrowSeconds !== null &&
  keyboardAdvancedAssertion.seconds !== null &&
  Number(keyboardAdvancedAssertion.seconds) > Number(firstArrowSeconds)

console.log('keyboard hover assertion:', keyboardAssertion, keyboardAdvancedAssertion, '| ok:', keyboardOk)

console.log('bad responses:', bad.length ? bad : 'none')
console.log('logs:', logs.length ? logs : 'none')
await page.screenshot({ path: out })
await browser.close()

if (!chartHoverOk || !mapHoverOk || !clearedOk || !keyboardOk) {
  console.error('FAIL - track hover sync assertion did not pass')
  process.exit(1)
}
console.log('PASS - track hover sync assertion passed')
