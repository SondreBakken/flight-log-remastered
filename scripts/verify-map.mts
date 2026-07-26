import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:3005/flights/1001428'
const out = process.argv[3] ?? 'verify-track.png'

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const logs: string[] = []
const bad: string[] = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack?.split('\n').slice(0,4).join('\n')}`))
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`) })
page.on('requestfailed', (r) => bad.push(`FAILED ${r.failure()?.errorText} ${r.url()}`))

await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(6000)

console.log('bad responses:', bad.length ? bad : 'none')
console.log('logs:', logs.length ? logs : 'none')
console.log('mapDivs:', await page.locator('.maplibregl-map').count())
await page.screenshot({ path: out })
await browser.close()
