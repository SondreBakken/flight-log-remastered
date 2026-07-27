import { chromium } from 'playwright'

// #38's end-to-end proof: a real browser, navigating to the prerendered takeoffs preview
// page, actually issues a network request for the takeoffs asset and renders the real
// fetched row count — not something baked into the initial HTML, and not a hardcoded number
// in the component. Run against `pnpm run build && pnpm run start` (the static artifact
// this route serves only exists after a real build — see check-takeoffs-prerender.mts),
// never against `pnpm dev`, which would re-run `getTakeoffs` against flightlog.org live.
const url = process.argv[2] ?? 'http://localhost:3000/countries/160/takeoffs'
const EXPECTED_ROW_COUNT = 6012 // fixtures/takeoffs-160.html, pinned by check:parsers too

let overallOk = true
function report(ok: boolean, label: string): void {
  console.log(`${ok ? 'ok' : 'FAIL'} - ${label}`)
  if (!ok) overallOk = false
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })

const takeoffRequests: string[] = []
const badResponses: string[] = []
page.on('request', (r) => {
  if (r.url().includes('/api/countries/') && r.url().includes('/takeoffs')) takeoffRequests.push(r.url())
})
page.on('response', (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`)
})
const pageErrors: string[] = []
page.on('pageerror', (e) => pageErrors.push(e.message))

await page.goto(url, { waitUntil: 'domcontentloaded' })

// A DEFINITIVE settle condition — the count line rendered, or the error state did (never
// "loading text absent", which is vacuously true before hydration has even started).
const settled = await page
  .waitForFunction(
    () => document.body.textContent?.includes('takeoffs loaded') || document.body.textContent?.includes('request failed'),
    { timeout: 20000 },
  )
  .then(() => true)
  .catch(() => false)
report(settled, 'the preview settles (row count or an error renders) within the timeout, instead of hanging on "Loading takeoffs…" forever')

if (settled) {
  // document.body.textContent picks up the inlined RSC payload script tags too (same as
  // other pages in this app), which is unreadable noise here — the nav links plus the
  // preview's own line are what the assertions below actually care about.
  const bodyText = await page.evaluate(() => document.querySelector('main')?.textContent ?? '')
  console.log('rendered <main> text:', bodyText)

  report(
    takeoffRequests.length > 0,
    `the BROWSER itself issued a network request for the takeoffs asset (saw: ${takeoffRequests.join(', ') || 'none'}) — proves this is a real client-side fetch, not data already resident in the initial HTML`,
  )
  report(
    bodyText.includes(`${EXPECTED_ROW_COUNT} takeoffs loaded`),
    `renders the real fetched row count, ${EXPECTED_ROW_COUNT} (Norway's full fixture size), not a hardcoded placeholder (rendered: "${bodyText.trim()}")`,
  )
  report(badResponses.length === 0, `no unexpected 4xx/5xx responses (saw: ${badResponses.length ? badResponses.join('; ') : 'none'})`)
  report(pageErrors.length === 0, `no uncaught page errors (saw: ${pageErrors.length ? pageErrors.join('; ') : 'none'})`)
}

await browser.close()

if (!overallOk) {
  console.error('FAIL - takeoffs preview browser assertion did not pass')
  process.exit(1)
}
console.log('PASS - takeoffs preview browser assertion passed')
