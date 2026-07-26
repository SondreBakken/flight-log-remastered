import { chromium } from 'playwright'
const [url, out] = process.argv.slice(2)
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const bad: string[] = []
page.on('response', r => { if (r.status() >= 400 && r.url().startsWith('http://localhost')) bad.push(`${r.status()} ${r.url()}`) })
page.on('pageerror', e => bad.push('pageerror: ' + e.message))
await page.goto(url, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.maplibregl-canvas', { timeout: 8000 }).catch(() => {})
await page.waitForTimeout(5000)
await page.screenshot({ path: out, fullPage: true })
console.log(out, '| problems:', bad.length ? bad : 'none')
await browser.close()
