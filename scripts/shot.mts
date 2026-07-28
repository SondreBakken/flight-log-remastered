import { chromium } from 'playwright'
import { captureUrlScreenshot } from './lib/screenshot'

// Captures the full page, not just the viewport, by resizing the viewport to the page's
// real height rather than passing `fullPage: true` to Playwright's screenshot() — on a
// page holding a MapLibre WebGL canvas, `fullPage` silently discards the drawing buffer
// and the canvas comes back blank while DOM overlays keep rendering (#21). See
// scripts/lib/screenshot.ts for the full reasoning and scripts/verify-shot.mts for the
// pixel-level regression check against this exact capture path.
const [url, out] = process.argv.slice(2)
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const { badResponses } = await captureUrlScreenshot(browser, url, out)
console.log(out, '| problems:', badResponses.length ? badResponses : 'none')
await browser.close()
