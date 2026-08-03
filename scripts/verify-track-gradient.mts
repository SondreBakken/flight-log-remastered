import { chromium } from 'playwright'

// Headless, never the Chrome extension: an unfocused extension window pauses
// requestAnimationFrame and would photograph (and let map internals report) an empty
// canvas. See TrackMap's assignment of window.__flightTrackMap for why this can reach
// into the live map instance instead of trusting a screenshot alone (issue #21: raster
// tiles intermittently do not appear in captures for reasons unrelated to this change).
//
// Run against `pnpm run build && pnpm run start`, never `pnpm dev` (#47): the handle above is
// gated behind the `__verifyMap` query param, not NODE_ENV, precisely so it survives into a
// production bundle — dev mode is the least likely place to reproduce a bundler-specific
// failure (see README's maplibre-gl v6/Turbopack note), and until now it was the only mode
// this script had ever run against.
const url = process.argv[2] ?? 'http://localhost:3000/flights/1001428?__verifyMap'
const out = process.argv[3] ?? 'verify-track-gradient.png'

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })

// #47 review gap: only the `?__verifyMap` URL above was ever exercised end-to-end, so nothing
// pinned the gate's NEGATIVE direction — that window.__flightTrackMap stays undefined on an
// ORDINARY navigation, without the param. A call site degraded to `if (true)` (see
// track-map.tsx) would have stayed green through this whole script and every other check in
// the repo, since every one of them sends the param. Runs first, in its own throwaway page, so
// it cannot leave state the main run below depends on, and its own FAIL/exit-1 branch below now
// aborts the whole script on a dead server rather than letting a broken assertion run anyway.
const baseUrl = url.split('?')[0]
const negativePage = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const negativeLogs: string[] = []
const negativeBad: string[] = []
negativePage.on('console', (m) => negativeLogs.push(`[${m.type()}] ${m.text()}`))
negativePage.on('pageerror', (e) =>
  negativeLogs.push(`[pageerror] ${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`),
)
negativePage.on('response', (r) => {
  if (r.status() >= 400) negativeBad.push(`${r.status()} ${r.url()}`)
})
negativePage.on('requestfailed', (r) => negativeBad.push(`FAILED ${r.failure()?.errorText} ${r.url()}`))

await negativePage.goto(baseUrl, { waitUntil: 'domcontentloaded' })
// "the handle stays undefined" is only meaningful if the map had a chance to render first: on
// a page that never rendered at all, the handle is vacuously undefined and the check below
// would prove nothing about the __verifyMap gating it claims to test. The base URL renders the
// map without ?__verifyMap (the param gates only the debug handle, not the map itself), so a
// missing canvas here means the server is dead, not that the gate works, hence the hard abort
// instead of falling through to the (meaningless) assertion.
const negativeCanvasAppeared = await negativePage
  .waitForSelector('.maplibregl-canvas', { timeout: 20000 })
  .then(() => true)
  .catch(() => false)
if (!negativeCanvasAppeared) {
  // Also fires for a real flight with zero track points (see track-map.tsx): that renders a
  // "No track points" placeholder with no canvas at all, which reads identically to a dead
  // server here even though the server is fine.
  console.error("FAIL - the negative probe's page never rendered a map canvas, within the timeout")
  console.log('bad responses:', negativeBad.length ? negativeBad : 'none')
  console.log('logs:', negativeLogs.length ? negativeLogs : 'none')
  await negativePage.close()
  await browser.close()
  process.exit(1)
}
await negativePage.waitForTimeout(1000)
const handleExposedWithoutParam = await negativePage.evaluate(() => window.__flightTrackMap !== undefined)
await negativePage.close()
console.log(
  handleExposedWithoutParam
    ? 'FAIL - window.__flightTrackMap is set on an ordinary navigation without ?__verifyMap'
    : 'ok - window.__flightTrackMap stays undefined on an ordinary navigation without ?__verifyMap',
)

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

// A DEFINITIVE settle condition, the same one verify-track-hover.mts uses: the map instance
// exists AND its flight-track source has actually finished loading. The previous canvas
// waitForSelector + swallowed waitForFunction here settled vacuously on a page with no map at
// all (a Suspense skeleton, or a client-side navigation error), and the assertion below would
// then just read "window.__flightTrackMap is not set" off a page that never got a chance to load.
const settled = await page
  .waitForFunction(
    () => window.__flightTrackMap !== undefined && window.__flightTrackMap.isSourceLoaded('flight-track') === true,
    { timeout: 20000 },
  )
  .then(() => true)
  .catch(() => false)
if (!settled) {
  console.error(
    'FAIL - the scene did not settle: window.__flightTrackMap never appeared with its flight-track source loaded, within the timeout',
  )
  console.log('bad responses:', bad.length ? bad : 'none')
  console.log('logs:', logs.length ? logs : 'none')
  await browser.close()
  process.exit(1)
}
// isSourceLoaded only reports that the GeoJSON parsed and indexed, not that MapLibre has
// painted a frame with it. This mirrors the paint-idle wait the sibling verify-track-*
// scripts use after the same isSourceLoaded check.
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
await page.waitForTimeout(1000)

const assertion = await page.evaluate(() => {
  const map = window.__flightTrackMap
  if (!map) return { ok: false, reason: 'window.__flightTrackMap is not set' }

  const sourceLoaded = map.isSourceLoaded('flight-track')

  const features = map.querySourceFeatures('flight-track')
  const hasTrackFeature = features.some((f) => f.geometry.type === 'LineString')

  const gradient = map.getPaintProperty('flight-track-line', 'line-gradient') as unknown
  const hasGradient = Array.isArray(gradient) && gradient[0] === 'interpolate'

  // The interpolate expression is ['interpolate', ['linear'], ['line-progress'], f0, c0, f1,
  // c1, ...]: fractions at even offsets from index 3, colours at odd offsets.
  const stopFractions: number[] = Array.isArray(gradient)
    ? gradient.filter((_, i) => i >= 3 && (i - 3) % 2 === 0).map(Number)
    : []
  const stopColors: string[] = Array.isArray(gradient)
    ? gradient.filter((_, i) => i >= 3 && (i - 3) % 2 === 1).map(String)
    : []
  const distinctColorCount = new Set(stopColors).size

  // Distinct colours alone doesn't inspect WHERE those colours land: a bug that replaces
  // real distance-based stop spacing with uniform index spacing (the actual regression this
  // feature shipped with once) still produces many distinct colours, so it stayed green
  // under a colour-count-only check. Real GPS tracks are not perfectly evenly paced (climbs,
  // thermalling circles, and glides all cover different ground per elapsed point), so a
  // healthy stop-fraction sequence should not be perfectly evenly spaced either. This checks
  // that directly: the coefficient of variation of the gaps between consecutive stops, which
  // is ~0 for perfectly even spacing and clearly nonzero for real distance-based spacing
  // (see check-track-gradient.mts's synthetic-flight fixture for the same signal, measured
  // there at CV ~0.7 for correct behaviour vs ~1e-15 for uniform spacing).
  const fractionDeltas: number[] = []
  for (let i = 1; i < stopFractions.length; i++) fractionDeltas.push(stopFractions[i] - stopFractions[i - 1])
  const meanDelta = fractionDeltas.reduce((a, b) => a + b, 0) / fractionDeltas.length
  const variance = fractionDeltas.reduce((a, b) => a + (b - meanDelta) ** 2, 0) / fractionDeltas.length
  const fractionCoefficientOfVariation = Math.sqrt(variance) / meanDelta

  const fractionsAreFiniteAndIncreasing = stopFractions.every(
    (f, i) => Number.isFinite(f) && (i === 0 || f > stopFractions[i - 1]),
  )

  return {
    ok:
      sourceLoaded &&
      hasTrackFeature &&
      hasGradient &&
      distinctColorCount > 1 &&
      fractionsAreFiniteAndIncreasing &&
      fractionCoefficientOfVariation > 0.05,
    sourceLoaded,
    hasTrackFeature,
    featureCount: features.length,
    hasGradient,
    gradientStopCount: stopColors.length,
    distinctColorCount,
    fractionsAreFiniteAndIncreasing,
    fractionCoefficientOfVariation,
  }
})

console.log('bad responses:', bad.length ? bad : 'none')
console.log('logs:', logs.length ? logs : 'none')
console.log('mapDivs:', await page.locator('.maplibregl-map').count())
console.log('track-gradient assertion:', assertion)
await page.screenshot({ path: out })
await browser.close()

if (!assertion.ok || handleExposedWithoutParam) {
  console.error('FAIL - track gradient assertion did not pass')
  process.exit(1)
}
console.log('PASS - track gradient assertion passed')
