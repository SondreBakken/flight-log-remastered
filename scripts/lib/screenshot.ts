import { chromium, type Browser, type Page } from 'playwright'

export type ViewportSize = { width: number; height: number }
export type CaptureResult = { badResponses: string[]; documentSize: ViewportSize }

// Software WebGL, since every script that drives a headless capture (shot.mts,
// verify-shot.mts) runs without a real GPU. Shared so a launch-flag change can't drift
// between the two.
const HEADLESS_LAUNCH_ARGS = ['--enable-unsafe-swiftshader']

export function launchCaptureBrowser(): Promise<Browser> {
  return chromium.launch({ args: HEADLESS_LAUNCH_ARGS })
}

/**
 * Resizes the viewport to the document's current scrollable size, then re-measures after
 * the resize's own layout settles. The two can differ: an element sized in `vh` units (the
 * flight map is `h-[70vh]`) grows again once the viewport itself grows, so the document can
 * end up taller than the size it was just resized to. The size this returns is the one
 * AFTER that second growth.
 */
export async function growViewportToDocument(page: Page): Promise<ViewportSize> {
  const documentSize = () =>
    page.evaluate(() => ({
      width: Math.ceil(document.documentElement.scrollWidth),
      height: Math.ceil(document.documentElement.scrollHeight),
    }))
  await page.setViewportSize(await documentSize())
  // Resizing the viewport changes the MapLibre container's size, which the map only
  // repaints in response to (a resize-driven redraw), not synchronously with the resize
  // call itself.
  await page.waitForTimeout(300)
  return documentSize()
}

/**
 * Captures the whole document, not just the viewport: resize to the document's real size
 * (growViewportToDocument above), THEN `fullPage: true` on top of that. See README's #21
 * section for the full story this is the fix for. In short: `fullPage` alone discards the
 * WebGL drawing buffer on a page holding a MapLibre canvas; the resize alone truncates a
 * page whose height is itself a function of viewport height, because growing the viewport
 * can grow the document past the size just measured. Neither problem survives the
 * combination — measured repeatedly: the resize is what keeps the WebGL canvas painted,
 * `fullPage`'s stitching is what then picks up the further growth the resize itself causes.
 *
 * `preserveDrawingBuffer: true` on the MapLibre context was considered and rejected: it
 * would force the browser to retain (and pay a real per-frame copy cost for) the drawing
 * buffer on every real page load, for every visitor, purely so this dev-only script can
 * screenshot the page after the fact — a permanent runtime cost for an occasional
 * capture-time need, paid by users who never run this script.
 */
export async function captureFullDocumentScreenshot(page: Page, outPath: string): Promise<ViewportSize> {
  const documentSize = await growViewportToDocument(page)
  await page.screenshot({ path: outPath, fullPage: true })
  return documentSize
}

/**
 * Navigates a fresh page to `url`, waits for it to settle, and captures it via
 * captureFullDocumentScreenshot — the entire per-URL flow scripts/shot.mts runs, factored
 * out so scripts/verify-shot.mts can drive this exact path rather than a reimplementation
 * that could drift from what ships.
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
  // KNOWN GAP, measured: verify-shot.mts's assertions are all outcome-based (final pixel
  // content, final document height), not timing-based, so they can only catch a settle
  // condition that's actually too weak to have finished by capture time — not one that's
  // weak in principle. Cutting this wait (and growViewportToDocument's 300ms one) to 0
  // stayed green 5/5 runs against this app's real flight page: the CDP round trips and
  // fullPage's own stitching work that happen between here and the actual screenshot leave
  // enough incidental latency for MapLibre to finish painting anyway in this environment
  // (local, software-rendered, warm tile cache). Nothing here turns that into a reliable RED.
  await page.waitForTimeout(5000)
  const documentSize = await captureFullDocumentScreenshot(page, outPath)

  await page.close()
  return { badResponses, documentSize }
}
