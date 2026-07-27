import { chromium } from 'playwright'

// #9's end-to-end proof, superseding #38's row-count-only version: a real browser, navigating
// to the prerendered takeoffs directory, actually issues a network request for the takeoffs
// asset, renders the real fetched count, shows a visible truncation notice for the unfiltered
// (6012-row) view, and narrows to a real match when the user types a folded, diacritic-free
// query — not something baked into the initial HTML, and not a component that ignores its own
// input. Run against `pnpm run build && pnpm run start` (the static artifact this route
// serves only exists after a real build — see check-takeoffs-prerender.mts), never against
// `pnpm dev`, which would re-run `getTakeoffs`/`getRegions` against flightlog.org live.
const url = process.argv[2] ?? 'http://localhost:3000/countries/160/takeoffs'
const EXPECTED_ROW_COUNT = 6012 // fixtures/takeoffs-160.html, pinned by check:parsers too
const MAX_RENDERED_RESULTS = 200 // select-visible-takeoffs.ts's own cap

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

// A DEFINITIVE settle condition — the fetched count line rendered, or the error state did
// (never "loading text absent", which is vacuously true before hydration has even started).
const settled = await page
  .waitForFunction(
    () => document.body.textContent?.includes(' takeoffs') || document.body.textContent?.includes('request failed'),
    { timeout: 20000 },
  )
  .then(() => true)
  .catch(() => false)
report(settled, 'the directory settles (a fetched count or an error renders) within the timeout, instead of hanging on "Loading takeoffs…" forever')

if (settled) {
  const mainText = async () => page.evaluate(() => document.querySelector('main')?.textContent ?? '')

  const initialText = await mainText()
  console.log('rendered <main> text (unfiltered):', initialText)

  report(
    takeoffRequests.length > 0,
    `the BROWSER itself issued a network request for the takeoffs asset (saw: ${takeoffRequests.join(', ') || 'none'}) — proves this is a real client-side fetch, not data already resident in the initial HTML`,
  )
  report(
    initialText.includes(`${EXPECTED_ROW_COUNT} takeoffs`),
    `renders the real fetched row count, ${EXPECTED_ROW_COUNT} (Norway's full fixture size), not a hardcoded placeholder (rendered: "${initialText.trim()}")`,
  )
  report(
    initialText.includes(`Showing ${MAX_RENDERED_RESULTS} of ${EXPECTED_ROW_COUNT} matches`),
    `shows a VISIBLE truncation notice for the unfiltered ${EXPECTED_ROW_COUNT}-row view, capped to ${MAX_RENDERED_RESULTS} rendered rows (rendered: "${initialText.trim()}")`,
  )

  // Real Norwegian folding, live: "Bodo" (plain ASCII) finding "Bodø" through the actual
  // rendered input, not a unit test calling the fold function directly.
  await page.getByRole('textbox', { name: /takeoff name/i }).fill('Bodo')
  const filteredSettled = await page
    .waitForFunction(() => document.querySelector('main')?.textContent?.includes('Bodø'), { timeout: 10000 })
    .then(() => true)
    .catch(() => false)
  const filteredText = await mainText()
  console.log('rendered <main> text (filtered "Bodo"):', filteredText)
  report(filteredSettled, `typing the plain-ASCII query "Bodo" into the real input finds "Bodø" in the real rendered rows (rendered: "${filteredText.trim()}")`)
  report(
    !filteredText.includes(`Showing ${MAX_RENDERED_RESULTS} of ${EXPECTED_ROW_COUNT} matches`),
    'the truncation notice reflects the narrowed match count, not the original unfiltered total, once a query is typed',
  )

  report(badResponses.length === 0, `no unexpected 4xx/5xx responses (saw: ${badResponses.length ? badResponses.join('; ') : 'none'})`)
  report(pageErrors.length === 0, `no uncaught page errors (saw: ${pageErrors.length ? pageErrors.join('; ') : 'none'})`)
}

await browser.close()

if (!overallOk) {
  console.error('FAIL - takeoffs directory browser assertion did not pass')
  process.exit(1)
}
console.log('PASS - takeoffs directory browser assertion passed')
