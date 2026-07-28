import { chromium, type Page } from 'playwright'
import { createReporter } from './lib/verify-report'
import { SCORING_LINE_COLOR } from '../src/features/show-flight-track/colors'

// #15's scoring overlay, checked against three real flights (each exercising a different
// absence shape) plus one toggle — see README's own section on this script for why each
// scene exists. `?__verifyMap` and `pnpm run build && pnpm run start` for the same reason as
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

async function clickRadioByLabelPrefix(page: Page, prefix: string): Promise<void> {
  await page.evaluate((labelPrefix) => {
    const labels = Array.from(document.querySelectorAll('[data-testid="scoring-overlay-option"]'))
    const target = labels.find((label) => label.textContent?.trim().startsWith(labelPrefix))
    const input = target?.querySelector('input[type="radio"]') as HTMLInputElement | null
    input?.click()
  }, prefix)
}

// === Scene 1: trip 1001428, every geometry available ===================================

const fullSetPage = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
const fullSetBad = trackBadResponses(fullSetPage)
await fullSetPage.goto(`${baseUrl}/flights/1001428?__verifyMap`, { waitUntil: 'domcontentloaded' })
await waitForMapIdle(fullSetPage)

const fullSetRadios = await readRadios(fullSetPage)
const fullSetSourceLoaded = await fullSetPage
  .evaluate(() => window.__flightTrackMap?.isSourceLoaded('scoring-overlay') ?? null)
  .catch(() => null)
const fullSetMarkerCount = await readTurnpointMarkerCount(fullSetPage)
const fullSetSummary = await readSummary(fullSetPage)

console.log('\n=== trip 1001428 (full set) ===')
console.log('radios:', fullSetRadios)
console.log('scoring source loaded:', fullSetSourceLoaded)
console.log('turnpoint markers:', fullSetMarkerCount)
console.log('summary text:', fullSetSummary)

report(fullSetRadios.some((r) => r.label.startsWith('Open distance') && r.checked), 'trip 1001428: Open distance is selected by default')
report(fullSetRadios.every((r) => !r.disabled), 'trip 1001428: every scoring overlay option is available (full set)')
report(fullSetSourceLoaded === true, 'trip 1001428: the scoring-overlay map source loaded')
report(fullSetMarkerCount === 2, `trip 1001428: open distance renders 2 turnpoint markers (got ${fullSetMarkerCount})`)
report(fullSetSummary === 'Open distance: 48.95 km', `trip 1001428: the summary shows the geometry's own scored distance (got "${fullSetSummary}")`)

// The scoring line's own colour actually appears on the canvas, not just source/layer
// existence — an existence-only check passes even for a wholly wrong (or empty) geometry, as
// long as SOME source and layer got added. Sampled the same way verify-shot.mts/
// verify-track-gradient.mts sample the altitude ramp: crop to the canvas element, decode the
// screenshot back into pixels, and look for SCORING_LINE_COLOR among them.
const canvasRect = await fullSetPage.evaluate(() => {
  const el = document.querySelector('.maplibregl-canvas')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})
if (canvasRect) {
  const screenshotBuffer = await fullSetPage.screenshot()
  const base64 = screenshotBuffer.toString('base64')
  const { distinctColors, matchDistance } = await fullSetPage.evaluate(
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
const centerBefore = await fullSetPage.evaluate(() => {
  const map = window.__flightTrackMap
  return map ? { center: map.getCenter().toArray(), zoom: map.getZoom() } : null
})

await clickRadioByLabelPrefix(fullSetPage, 'Distance over 5 points')
await fullSetPage.waitForTimeout(500)

const centerAfter = await fullSetPage.evaluate(() => {
  const map = window.__flightTrackMap
  return map ? { center: map.getCenter().toArray(), zoom: map.getZoom() } : null
})
const toggledRadios = await readRadios(fullSetPage)
const toggledMarkerCount = await readTurnpointMarkerCount(fullSetPage)
const toggledSummary = await readSummary(fullSetPage)

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
  toggledSummary !== null && toggledSummary.startsWith('Distance over 5 points:') && toggledSummary !== fullSetSummary,
  `trip 1001428: the summary actually updated to the newly selected geometry (got "${toggledSummary}")`,
)

await fullSetPage.close()
report(fullSetBad.length === 0, `trip 1001428: no unexpected 4xx/5xx responses or failed requests (saw: ${fullSetBad.length ? fullSetBad.join('; ') : 'none'})`)

// === Scene 2: trip 991729, degenerate 5pt/4pt =============================================

const shortFlightPage = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
const shortFlightBad = trackBadResponses(shortFlightPage)
await shortFlightPage.goto(`${baseUrl}/flights/991729?__verifyMap`, { waitUntil: 'domcontentloaded' })
await waitForMapIdle(shortFlightPage)

const shortFlightRadios = await readRadios(shortFlightPage)
console.log('\n=== trip 991729 (short flight, degenerate 5pt/4pt) ===')
console.log('radios:', shortFlightRadios)

report(
  shortFlightRadios.find((r) => r.label.startsWith('Distance over 5 points'))?.disabled === true,
  'trip 991729: the degenerate 5-point geometry is disabled, not selectable',
)
report(
  shortFlightRadios.find((r) => r.label.startsWith('Distance over 4 points'))?.disabled === true,
  'trip 991729: the degenerate 4-point geometry is disabled, not selectable',
)
report(
  shortFlightRadios.some((r) => r.label.startsWith('Open distance') && r.checked && !r.disabled),
  'trip 991729: Open distance (not degenerate) is still selected by default',
)

await shortFlightPage.close()
report(shortFlightBad.length === 0, `trip 991729: no unexpected 4xx/5xx responses or failed requests (saw: ${shortFlightBad.length ? shortFlightBad.join('; ') : 'none'})`)

// === Scene 3: trip 235690, out-and-return placemark entirely missing ======================

const missingPlacemarkPage = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
const missingPlacemarkBad = trackBadResponses(missingPlacemarkPage)
await missingPlacemarkPage.goto(`${baseUrl}/flights/235690?__verifyMap`, { waitUntil: 'domcontentloaded' })
await waitForMapIdle(missingPlacemarkPage)

const missingPlacemarkRadios = await readRadios(missingPlacemarkPage)
console.log('\n=== trip 235690 (missing out-and-return placemark entirely) ===')
console.log('radios:', missingPlacemarkRadios)

report(
  missingPlacemarkRadios.find((r) => r.label.startsWith('Out-and-return distance'))?.disabled === true,
  'trip 235690: the entirely-missing out-and-return placemark is disabled, not selectable',
)
report(
  missingPlacemarkRadios.some((r) => r.label.startsWith('Open distance') && r.checked && !r.disabled),
  'trip 235690: Open distance (present) is still selected by default',
)

await missingPlacemarkPage.close()
report(missingPlacemarkBad.length === 0, `trip 235690: no unexpected 4xx/5xx responses or failed requests (saw: ${missingPlacemarkBad.length ? missingPlacemarkBad.join('; ') : 'none'})`)

await browser.close()

finish('scoring overlay verification')
