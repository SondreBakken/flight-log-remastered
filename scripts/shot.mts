import { launchCaptureBrowser, captureUrlScreenshot } from './lib/screenshot'

// Captures the whole page, including a MapLibre WebGL canvas without it going blank — see
// scripts/lib/screenshot.ts for how and why (#21), and scripts/verify-shot.mts for the
// pixel-level regression check against this exact capture path.
const [url, out] = process.argv.slice(2)
const browser = await launchCaptureBrowser()
const { badResponses } = await captureUrlScreenshot(browser, url, out)
console.log(out, '| problems:', badResponses.length ? badResponses : 'none')
await browser.close()
