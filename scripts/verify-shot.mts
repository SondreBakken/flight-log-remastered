import { chromium } from 'playwright'
import fs from 'node:fs'
import { captureUrlScreenshot } from './lib/screenshot'

// #21: `scripts/shot.mts` once passed `fullPage: true` straight to Playwright's
// screenshot(), which silently discards the WebGL drawing buffer on a page holding a
// MapLibre canvas — DOM overlays (markers, controls, the SVG barogram) kept rendering, so
// a blank map read as a partly working one, not an obviously broken capture. Nothing in
// this repo looked at shot.mts's own output pixel-by-pixel, so that shipped and sat
// unnoticed for two issues before being caught and corrected on this thread. This script
// is that missing check.
//
// It drives scripts/lib/screenshot.ts's captureUrlScreenshot — the exact function
// shot.mts's CLI calls, not a reimplementation — so a regression in the real capture path
// (fullPage reintroduced, or its settle condition weakened enough to race the render)
// fails here too, not just a copy of the logic that could drift from what ships.
//
// Scoped to the flight TRACK map (src/features/show-flight-track), the surface #21 was
// found on and the only one with a live signal rich enough to prove GEOMETRY specifically
// rendered rather than just raster tiles: a per-point altitude gradient (see
// altitude-color.ts) that assigns real, distinctive colours along the line. #11's takeoffs
// map (src/components/takeoffs-map) is not re-verified here — its own verify-sites-map.mts
// already asserts directly on live MapLibre state (queryRenderedFeatures, getBounds, ...)
// and never calls page.screenshot() at all, so it was never exposed to shot.mts's fullPage
// bug in the first place. The fix lives in the capture function both map pages' screenshots
// would go through, so it protects the takeoffs map too; this script just doesn't add
// pixel-level coverage for it.
//
// Run against `pnpm run build && pnpm run start`, never `pnpm dev` — same reason as
// verify-track-gradient.mts (#47): `?__verifyMap`'s window.__flightTrackMap handle is
// gated behind a query param, not NODE_ENV, specifically so it survives into a production
// bundle, and production is the mode this repo has already lost time to a bundler-specific
// failure under (see README's maplibre-gl v6/Turbopack note).
const url = process.argv[2] ?? 'http://localhost:3000/flights/1001428?__verifyMap'
const outPath = process.argv[3] ?? 'verify-shot.png'

let overallOk = true
function report(ok: boolean, label: string): void {
  console.log(`${ok ? 'ok' : 'FAIL'} - ${label}`)
  if (!ok) overallOk = false
}

function parseRgb(css: string): [number, number, number] {
  const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
}

function colorDistance(a: readonly number[], b: readonly number[]): number {
  return Math.sqrt((a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2)
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })

// A ground-truth page, independent of shot.mts's own capture/settle logic below: it waits
// on LIVE map state (both sources actually finished loading), not a flat timeout, so it
// stays a trustworthy oracle even if the capture path's own settle condition is the thing
// that regressed.
const truthPage = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
await truthPage.goto(url, { waitUntil: 'domcontentloaded' })
await truthPage.waitForSelector('.maplibregl-canvas', { timeout: 20000 }).catch(() => {})
const settled = await truthPage
  .waitForFunction(
    () =>
      window.__flightTrackMap !== undefined &&
      window.__flightTrackMap.isSourceLoaded('flight-track') === true &&
      window.__flightTrackMap.isSourceLoaded('osm') === true,
    { timeout: 20000 },
  )
  .then(() => true)
  .catch(() => false)
report(
  settled,
  'the ground-truth page settles: window.__flightTrackMap exists and both its track and osm-tile sources finished loading, within the timeout',
)

const stopColors: string[] = settled
  ? await truthPage.evaluate(() => {
      const gradient = window.__flightTrackMap!.getPaintProperty('flight-track-line', 'line-gradient') as unknown
      return Array.isArray(gradient) ? gradient.filter((_, i) => i >= 3 && (i - 3) % 2 === 1).map(String) : []
    })
  : []
report(stopColors.length >= 2, `the live gradient carries at least 2 colour stops to look for in the capture (got ${stopColors.length})`)

const canvasRect = await truthPage.evaluate(() => {
  const el = document.querySelector('.maplibregl-canvas')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})
report(canvasRect !== null, 'the .maplibregl-canvas element is present, to know where in the capture to sample')
await truthPage.close()

// The actual deliverable: run the SAME capture code shot.mts ships, then look at what it
// actually wrote. A file existing proves nothing — the fullPage bug wrote a perfectly
// valid, blank PNG (#21) — only the pixels do.
const { badResponses } = await captureUrlScreenshot(browser, url, outPath)

if (canvasRect && stopColors.length >= 2) {
  const pixelPage = await browser.newPage()
  const base64 = fs.readFileSync(outPath).toString('base64')
  const { pixels, imageSize } = await pixelPage.evaluate(
    async ({ base64, rect }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${base64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const step = 4
      const x0 = Math.max(0, Math.floor(rect.x))
      const y0 = Math.max(0, Math.floor(rect.y))
      const x1 = Math.min(canvas.width, Math.ceil(rect.x + rect.width))
      const y1 = Math.min(canvas.height, Math.ceil(rect.y + rect.height))
      const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
      const w = x1 - x0
      const sampled: number[][] = []
      for (let y = 0; y < y1 - y0; y += step) {
        for (let x = 0; x < w; x += step) {
          const idx = (y * w + x) * 4
          sampled.push([data[idx]!, data[idx + 1]!, data[idx + 2]!])
        }
      }
      return { pixels: sampled, imageSize: [img.naturalWidth, img.naturalHeight] as [number, number] }
    },
    { base64, rect: canvasRect },
  )
  await pixelPage.close()

  console.log(`sampled ${pixels.length} pixels from the ${imageSize[0]}x${imageSize[1]} capture's canvas region`)

  const distinctColors = new Set(pixels.map((p) => p.join(','))).size
  // Measured directly against the bug (fullPage: true) in this exact region: anti-aliased
  // marker/control edges alone still leave ~130 distinct colours even though the WebGL
  // canvas underneath them is flat white, against 5800+ for a correctly rendered capture.
  // 500 sits with a wide margin on both sides — not tuned to the exact bug count.
  report(
    distinctColors > 500,
    `the canvas region is not near-uniform: ${distinctColors} distinct sampled colours (a blank capture leaves only anti-aliased DOM-overlay edges, ~130)`,
  )

  // Five stops spanning the live gradient, not just its extremes: a capture that only
  // rendered part of the track (a partial repaint racing a weakened settle condition)
  // could still pass an extremes-only check.
  const sampleFractions = [0, 0.25, 0.5, 0.75, 1]
  const sampleIndices = sampleFractions.map((f) => Math.min(stopColors.length - 1, Math.round(f * (stopColors.length - 1))))
  const targets = sampleIndices.map((i) => parseRgb(stopColors[i]!))

  // This is what actually distinguishes "tiles rendered, geometry didn't" (the maplibre
  // v6/Turbopack failure shape this repo has hit before — see README) from "capture is
  // blank": raster tile imagery never produces these specific, saturated, altitude-ramp
  // colours (TRACK_LINE_COLOR / amber-500 / red-600, see altitude-color.ts). Measured
  // against a real capture with the fullPage bug reintroduced: the nearest sampled pixel to
  // a mid-ramp colour sat 48-143 away once the line was actually missing, against 0-37 for
  // a correctly rendered one. 40 sits comfortably inside that gap.
  const COLOR_MATCH_THRESHOLD = 40
  for (const [i, target] of targets.entries()) {
    const minDistance = Math.min(...pixels.map((p) => colorDistance(p, target)))
    report(
      minDistance < COLOR_MATCH_THRESHOLD,
      `gradient stop colour rgb(${target.join(',')}) (sample ${i + 1}/${targets.length}) appears in the capture (nearest sampled pixel is ${minDistance.toFixed(1)} away, threshold ${COLOR_MATCH_THRESHOLD})`,
    )
  }
} else {
  report(false, 'skipping pixel checks: no canvas rect or no live gradient stops to check the capture against')
}

await browser.close()

report(badResponses.length === 0, `no unexpected 4xx/5xx responses or page errors during capture (saw: ${badResponses.length ? badResponses.join('; ') : 'none'})`)

if (!overallOk) {
  console.error('FAIL - shot.mts capture assertion did not pass')
  process.exit(1)
}
console.log('PASS - shot.mts capture assertion passed')
