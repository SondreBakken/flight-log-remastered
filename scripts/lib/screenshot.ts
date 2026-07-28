import type { Browser, Page } from 'playwright'

export type CaptureResult = { badResponses: string[] }

/**
 * Resizes the viewport to the page's full scrollable size, then takes a plain
 * (non-`fullPage`) screenshot of it.
 *
 * Deliberately NOT `page.screenshot({ fullPage: true })`. Proven by probe (#21): on a page
 * holding a MapLibre WebGL canvas, Chromium's `fullPage` capture path discards the WebGL
 * drawing buffer — the canvas comes back solid white while every DOM overlay (markers,
 * controls, the SVG barogram) survives untouched, so a broken capture reads as a partly
 * working map rather than an obviously empty one. A plain screenshot at the identical
 * settle condition, with the viewport itself sized to the page's real height instead of
 * relying on `fullPage`'s internal resize-and-stitch, renders both raster tiles and vector
 * geometry correctly (see scripts/verify-shot.mts for the pixel-level proof).
 *
 * `preserveDrawingBuffer: true` on the MapLibre context was considered and rejected: it
 * would force the browser to retain (and pay a real per-frame copy cost for) the drawing
 * buffer on every real page load, for every visitor, purely so this dev-only script can
 * screenshot the page after the fact. That is a permanent runtime cost for an occasional
 * capture-time need, paid by users who never run this script.
 */
export async function captureFullDocumentScreenshot(page: Page, outPath: string): Promise<void> {
  const { width, height } = await page.evaluate(() => ({
    width: Math.ceil(document.documentElement.scrollWidth),
    height: Math.ceil(document.documentElement.scrollHeight),
  }))
  await page.setViewportSize({ width, height })
  // Resizing the viewport changes the MapLibre container's size, which the map only
  // repaints in response to (a resize-driven redraw), not synchronously with the resize
  // call itself. A screenshot taken immediately after can still race that repaint.
  await page.waitForTimeout(300)
  await page.screenshot({ path: outPath })
}

/**
 * Navigates a fresh page to `url`, waits for it to settle, and captures it via
 * captureFullDocumentScreenshot. This is the entire per-URL flow `scripts/shot.mts` runs,
 * factored out so `scripts/verify-shot.mts` can drive the exact same capture path (including
 * this settle condition) rather than a hand-rolled stand-in — a regression here, `fullPage`
 * reintroduced or this settle weakened, is a regression in what verify-shot.mts tests too.
 */
export async function captureUrlScreenshot(browser: Browser, url: string, outPath: string): Promise<CaptureResult> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const badResponses: string[] = []
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().startsWith('http://localhost')) badResponses.push(`${r.status()} ${r.url()}`)
  })
  page.on('pageerror', (e) => badResponses.push('pageerror: ' + e.message))

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.maplibregl-canvas', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(5000)
  await captureFullDocumentScreenshot(page, outPath)

  await page.close()
  return { badResponses }
}
