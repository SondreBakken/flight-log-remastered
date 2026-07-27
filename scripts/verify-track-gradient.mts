import { chromium } from 'playwright'

// Headless, never the Chrome extension: an unfocused extension window pauses
// requestAnimationFrame and would photograph (and let map internals report) an empty
// canvas. See TrackMap's assignment of window.__flightTrackMap for why this can reach
// into the live map instance instead of trusting a screenshot alone (issue #21: raster
// tiles intermittently do not appear in captures for reasons unrelated to this change).
const url = process.argv[2] ?? 'http://localhost:3005/flights/1001428'
const out = process.argv[3] ?? 'verify-track-gradient.png'

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
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
await page.waitForFunction(() => window.__flightTrackMap?.isSourceLoaded('flight-track') === true, {
  timeout: 20000,
}).catch(() => {})
await page.waitForTimeout(1000)

const assertion = await page.evaluate(() => {
  const map = window.__flightTrackMap
  if (!map) return { ok: false, reason: 'window.__flightTrackMap is not set' }

  const sourceLoaded = map.isSourceLoaded('flight-track')

  const features = map.querySourceFeatures('flight-track')
  const hasTrackFeature = features.some((f) => f.geometry.type === 'LineString')

  const gradient = map.getPaintProperty('flight-track-line', 'line-gradient') as unknown
  const hasGradient = Array.isArray(gradient) && gradient[0] === 'interpolate'

  const stopColors: string[] = Array.isArray(gradient)
    ? gradient.filter((_, i) => i >= 3 && (i - 3) % 2 === 1).map(String)
    : []
  const distinctColorCount = new Set(stopColors).size

  return {
    ok: sourceLoaded && hasTrackFeature && hasGradient && distinctColorCount > 1,
    sourceLoaded,
    hasTrackFeature,
    featureCount: features.length,
    hasGradient,
    gradientStopCount: stopColors.length,
    distinctColorCount,
  }
})

console.log('bad responses:', bad.length ? bad : 'none')
console.log('logs:', logs.length ? logs : 'none')
console.log('mapDivs:', await page.locator('.maplibregl-map').count())
console.log('track-gradient assertion:', assertion)
await page.screenshot({ path: out })
await browser.close()

if (!assertion.ok) {
  console.error('FAIL - track gradient assertion did not pass')
  process.exit(1)
}
console.log('PASS - track gradient assertion passed')
