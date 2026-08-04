import fs from 'node:fs'
import { launchCaptureBrowser, captureUrlScreenshot, growViewportToDocument } from './lib/screenshot'
import { createReporter } from './lib/verify-report'
import { waitForCondition } from './lib/verify-settle'

// #21's pixel-level proof that scripts/shot.mts's capture isn't blank or truncated — see
// docs/testing.md's "verify-shot and the #21 capture bug" section for the full bug history and
// the fix this pins. This drives
// scripts/lib/screenshot.ts's captureUrlScreenshot, the exact function shot.mts's CLI
// calls, not a reimplementation, so a regression in the real capture path fails here too.
//
// Scoped to the flight TRACK map (src/features/show-flight-track), the surface #21 was
// found on and the only one with a live signal rich enough to prove GEOMETRY specifically
// rendered rather than just raster tiles: a per-point altitude gradient (see
// altitude-color.ts) that assigns real, distinctive colours along the line. #11's takeoffs
// map (src/components/takeoffs-map) is not covered here — its own verify-sites-map.mts
// asserts directly on live MapLibre state and never calls page.screenshot(), so it was
// never exposed to shot.mts's capture bug, and shot.mts itself has no way to reach it (the
// map there is behind a "Map" toggle click this script never performs, and the directory
// page is exactly viewport height, so the resize this script exercises is a no-op there
// too). This script's coverage is the flight track map specifically, not shot.mts in
// general. It also doesn't cover captureUrlScreenshot's own settle waits going weak: see
// the KNOWN GAP note on the post-selector wait in scripts/lib/screenshot.ts.
//
// Run against `pnpm run build && pnpm run start`, never `pnpm dev` — same reason as
// verify-track-gradient.mts (#47): `?__verifyMap`'s window.__flightTrackMap handle is
// gated behind a query param, not NODE_ENV, specifically so it survives into a production
// bundle, and production is the mode this repo has already lost time to a bundler-specific
// failure under (see README's maplibre-gl v6/Turbopack note).
const url = process.argv[2] ?? 'http://localhost:3000/flights/1001428?__verifyMap'
const outPath = process.argv[3] ?? 'verify-shot.png'

const { report, finish } = createReporter()

function parseRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function colorDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

const browser = await launchCaptureBrowser()

// A ground-truth page, independent of shot.mts's own capture/settle logic below: it waits
// on LIVE map state (both sources actually finished loading), not a flat timeout, so it
// stays a trustworthy oracle even if the capture path's own settle condition is the thing
// that regressed.
const truthPage = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
await truthPage.goto(url, { waitUntil: 'domcontentloaded' })
await truthPage.waitForSelector('.maplibregl-canvas', { timeout: 20000 }).catch(() => {})
const settled = await waitForCondition(
  truthPage,
  () =>
    window.__flightTrackMap !== undefined &&
    window.__flightTrackMap.isSourceLoaded('flight-track') === true &&
    window.__flightTrackMap.isSourceLoaded('osm') === true,
  20000,
)
report(
  settled,
  'the ground-truth page settles: window.__flightTrackMap exists and both its track and osm-tile sources finished loading, within the timeout',
)

// Same resize captureFullDocumentScreenshot performs on the capture page, run here too and
// BEFORE anything below reads canvas geometry from this page: the flight map is `h-[70vh]`,
// so its rendered size (and the canvas's position on the page) depends on viewport height.
// Measuring canvasRect at this page's original 1400x1000 viewport, while the actual capture
// happens after a resize to the full document height, samples the wrong rectangle — the
// canvas is taller and shifted down in the real capture than it is here uncapped. Doubles as
// the independent oracle for the captured PNG's height: computed on a separate page, via the
// same shared function, but not derived from anything captureUrlScreenshot itself returns,
// so a regression that skips or weakens the resize in the real capture path still gets
// caught here.
const documentSize = settled ? await growViewportToDocument(truthPage) : null

const stopColors: string[] = settled
  ? await truthPage.evaluate(() => {
      // line-gradient's expression layout: ['interpolate', ['linear'], ['line-progress'],
      // f0, c0, f1, c1, ...] — fractions at even offsets from index 3, colours at odd ones
      // (see verify-track-gradient.mts, which reads the same expression the same way).
      const gradient = window.__flightTrackMap!.getPaintProperty('flight-track-line', 'line-gradient') as unknown
      return Array.isArray(gradient) ? gradient.filter((_, i) => i >= 3 && (i - 3) % 2 === 1).map(String) : []
    })
  : []
// Distinct, not just present: altitude-color.ts's solidGradient fallback (a degraded
// gradient — flat-altitude track, or too few points) produces exactly two stops, both the
// SAME colour. A length-only check can't tell that apart from a real ramp; distinctness can.
const distinctStopColors = new Set(stopColors).size
report(distinctStopColors >= 2, `the live gradient carries at least 2 DISTINCT colour stops to look for in the capture (got ${distinctStopColors} distinct of ${stopColors.length} total)`)

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

if (canvasRect && distinctStopColors >= 2) {
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
      const sampled: [number, number, number][] = []
      for (let y = 0; y < y1 - y0; y += step) {
        for (let x = 0; x < w; x += step) {
          const idx = (y * w + x) * 4
          sampled.push([data[idx], data[idx + 1], data[idx + 2]])
        }
      }
      return { pixels: sampled, imageSize: [img.naturalWidth, img.naturalHeight] as [number, number] }
    },
    { base64, rect: canvasRect },
  )
  await pixelPage.close()

  console.log(`sampled ${pixels.length} pixels from the ${imageSize[0]}x${imageSize[1]} capture's canvas region`)

  // Catches the truncation shape of #21 (fullPage without a preceding resize, or the resize
  // without fullPage on top of it): a capture whose PNG is shorter than the document actually
  // was, at the moment its own height was last measured, has quietly cut off whatever sat
  // below the cut line. Checked against documentSize, not the capture page's own reported
  // size, so a mutation that skips or weakens the real capture's resize still gets caught.
  report(
    documentSize !== null && imageSize[1] >= documentSize.height,
    `captured PNG height (${imageSize[1]}) covers the full document height measured independently after the same resize (${documentSize?.height ?? 'N/A (ground-truth page did not settle)'})`,
  )

  const distinctColors = new Set(pixels.map((p) => p.join(','))).size
  // A blank canvas (the fullPage-without-resize shape of #21) leaves only anti-aliased
  // marker/control edges in this region — measured at ~130 distinct colours against 5800+
  // for a correctly rendered capture. 500 sits with a wide margin on both sides.
  report(
    distinctColors > 500,
    `the canvas region is not near-uniform: ${distinctColors} distinct sampled colours (a blank capture leaves only anti-aliased DOM-overlay edges, ~130)`,
  )

  // Five stops pulled in from the live gradient's true extremes, not sampled at them: a
  // capture that only rendered part of the track (a partial repaint racing a weakened settle
  // condition) could still pass an extremes-only check, AND the true endpoints sit close to
  // their own threshold even on a fully correct capture — stop 0's colour only appears
  // unblended in the track's first few pixels, stop 1's only in its last few (measured: the
  // fraction-1 endpoint cleared the threshold by only 5.1 of 40 sampled at the exact extreme,
  // a false RED waiting to happen under different antialiasing). [0.05 … 0.95] keeps the
  // sample points inside the ramp instead.
  const sampleFractions = [0.05, 0.25, 0.5, 0.75, 0.95]
  const sampleIndices = sampleFractions.map((f) => Math.min(stopColors.length - 1, Math.round(f * (stopColors.length - 1))))
  const targets = sampleIndices.map((i) => parseRgb(stopColors[i]))

  // This is what actually distinguishes "tiles rendered, geometry didn't" (the maplibre
  // v6/Turbopack failure shape this repo has hit before — see README) from "capture is
  // blank": raster tile imagery never produces these specific, saturated, altitude-ramp
  // colours (TRACK_LINE_COLOR / amber-500 / red-600, see altitude-color.ts). Measured directly
  // against that state (a degenerate zero-length track geometry: source/layer present and
  // "loaded", tiles render, nothing else does): the near-uniformity check above contributes
  // nothing (distinct sampled colours stayed at ~7000, nowhere near the 500 threshold — tiles
  // and DOM overlays alone give plenty of variety), and the two stops closest to this flight's
  // takeoff and landing (fractions 0.05 and 0.95, both low-altitude and both muted colours real
  // OSM terrain can reproduce by coincidence) passed this check too, at 29.6 and 8.8 against
  // the 40 threshold. All the discriminating power against this specific failure shape sat in
  // the three MIDDLE stops (0.25/0.5/0.75, spanning the climb — amber through red), which
  // failed clearly at 69.8, 92.7 and 109.2. The row still reported FAIL overall (those three
  // are enough), but this is not five independent checks — for a track whose climb is small
  // relative to its low-altitude time at both ends, this could plausibly narrow further.
  const COLOR_MATCH_THRESHOLD = 40
  for (const [i, target] of targets.entries()) {
    if (!target) {
      report(false, `gradient stop colour "${stopColors[sampleIndices[i]]}" (sample ${i + 1}/${targets.length}) parses as rgb(...) — got an unrecognised format instead`)
      continue
    }
    const minDistance = pixels.reduce((min, p) => Math.min(min, colorDistance(p, target)), Infinity)
    report(
      minDistance < COLOR_MATCH_THRESHOLD,
      `gradient stop colour rgb(${target.join(',')}) (sample ${i + 1}/${targets.length}) appears in the capture (nearest sampled pixel is ${minDistance.toFixed(1)} away, threshold ${COLOR_MATCH_THRESHOLD})`,
    )
  }
} else {
  report(false, 'skipping pixel checks: no canvas rect or fewer than 2 distinct live gradient stops to check the capture against')
}

await browser.close()

report(badResponses.length === 0, `no unexpected 4xx/5xx responses or page errors during capture (saw: ${badResponses.length ? badResponses.join('; ') : 'none'})`)

finish('shot.mts capture assertion')
