import { chromium } from 'playwright'

// #9's end-to-end proof, superseding #38's row-count-only version: a real browser, navigating
// to the prerendered takeoffs directory, actually issues a network request for the takeoffs
// asset, renders the real fetched count, shows a visible truncation notice for the unfiltered
// (6012-row) view, and narrows to a real match when the user types a folded, diacritic-free
// query — not something baked into the initial HTML, and not a component that ignores its own
// input. Extended by #12 to also prove: a real wind-direction selection narrows the real
// dataset and round-trips through the address bar as a shareable ?wind= link (server-validated,
// not just a client toggle), and a real, un-granted geolocation permission (Chromium
// auto-denies rather than hanging on a dialog) leaves the directory just as usable as before,
// never an error state. Run against `pnpm run build && pnpm run start` (the static artifact
// this route serves only exists after a real build — see check-takeoffs-prerender.mts), never
// against `pnpm dev`, which would re-run `getTakeoffs`/`getRegions` against flightlog.org live.
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

// A DEFINITIVE settle condition — the fetched count line rendered, OR the error state did
// (never "loading text absent", which is vacuously true before hydration has even started).
// Settling into the error state is deliberately included here so the wait itself can't hang
// forever on a real failure — but "settled" only means "stopped loading," not "succeeded":
// see reachedErrorState below, which is what actually judges the outcome.
//
// The success half must be `/\d+ takeoffs/`, not a bare `' takeoffs'` substring — the page's
// own static h1 ("{countryName} takeoffs") and the loading state ("Loading takeoffs…") both
// contain that exact substring from the very first paint, before any fetch has even started.
// A bare substring check is satisfied instantly regardless of the fetch, which means this
// wait never actually waited for anything — confirmed empirically: without the `\d+` anchor,
// `mainText()` below captured "Loading takeoffs…" as the "settled" state on a real run.
const settled = await page
  .waitForFunction(
    () => {
      const text = document.body.textContent ?? ''
      return /\d+ takeoffs/.test(text) || text.includes('request failed') || text.includes('timed out waiting for a response')
    },
    { timeout: 20000 },
  )
  .then(() => true)
  .catch(() => false)
report(settled, 'the directory settles (a fetched count or an error renders) within the timeout, instead of hanging on "Loading takeoffs…" forever')

if (settled) {
  const mainText = async () => page.evaluate(() => document.querySelector('main')?.textContent ?? '')

  const initialText = await mainText()
  console.log('rendered <main> text (unfiltered):', initialText)

  // Settling is not the same as succeeding — the wait above treats "the fetch itself failed"
  // as an acceptable way to stop waiting, so it can't hang forever, but this script's entire
  // purpose is proving the happy path against the prerendered artifact. A fetch failure here
  // means the artifact/API round trip is broken, not something to silently pass through and
  // leave to the row-count/notice assertions below to notice by proxy.
  const reachedErrorState = initialText.includes('request failed') || initialText.includes('timed out waiting for a response')
  report(
    !reachedErrorState,
    `the directory did not settle into a fetch-failure error state (rendered: "${initialText.trim()}")`,
  )

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
  // Only meaningful once filteredSettled is confirmed true — an ABSENT string is trivially
  // true of a blank or broken page too, so asserting it unconditionally would pass even if
  // "Bodø" never rendered at all (i.e. filtering silently stopped working outright), not just
  // when it rendered without the notice.
  if (filteredSettled) {
    report(
      !filteredText.includes(`Showing ${MAX_RENDERED_RESULTS} of ${EXPECTED_ROW_COUNT} matches`),
      'the truncation notice reflects the narrowed match count, not the original unfiltered total, once a query is typed',
    )
  }

  // #12: a real wind-direction selection, through the real <select>, against the real 6012-row
  // Norway fixture — not a unit test calling selectVisibleTakeoffs directly. Reads the TOTAL
  // match count from the truncation notice, not the rendered <li> count: both the unfiltered
  // view and a single-direction filter comfortably exceed the 200-row cap, so the rendered
  // count alone would stay pinned at 200 either way and could never catch a broken filter.
  // Cleared query first so this measures the wind filter alone, not query+wind together.
  await page.getByRole('textbox', { name: /takeoff name/i }).fill('')
  await page.waitForFunction(() => document.body.textContent?.includes('Showing 200 of 6012 matches'), { timeout: 10000 })
  const beforeWindTotal = await page.evaluate(() => {
    const match = document.body.textContent?.match(/of (\d+) matches/)
    return match ? Number(match[1]) : null
  })
  await page.getByRole('combobox', { name: /wind direction/i }).selectOption('N')
  const windSettled = await page
    .waitForFunction((prev) => {
      const match = document.body.textContent?.match(/of (\d+) matches/)
      const total = match ? Number(match[1]) : null
      return total !== null && total !== prev
    }, beforeWindTotal, { timeout: 10000 })
    .then(() => true)
    .catch(() => false)
  report(windSettled, 'selecting "Works in N" changes the total match count within the timeout')
  if (windSettled) {
    const afterWindTotal = await page.evaluate(() => {
      const match = document.body.textContent?.match(/of (\d+) matches/)
      return match ? Number(match[1]) : null
    })
    report(
      typeof afterWindTotal === 'number' && afterWindTotal < (beforeWindTotal ?? Infinity),
      `narrows the total match count, not widens it (before: ${beforeWindTotal}, after: ${afterWindTotal})`,
    )
    report(
      new URL(page.url()).searchParams.get('wind') === 'N',
      `updates the address bar to a shareable ?wind=N (url: ${page.url()})`,
    )

    // Shareable link, proven end to end: navigating fresh to that exact URL reproduces the
    // same filtered total an interactive selection just produced, not a different or
    // unfiltered one — this is the thing a user actually cares about, since it's the real
    // data the shared link delivers, not any one control's cosmetic state.
    //
    // Settling on ANY `<li>` in the page (the original condition here) is vacuous: the site
    // nav (see src/components/site-nav) renders its own `<li>` items from the very first
    // paint, long before the takeoffs fetch even starts, let alone before the wind filter has
    // applied — so that wait resolved almost instantly regardless of whether this feature
    // works at all, then read the DOM before the real content existed. Confirmed empirically:
    // against a real build, the old condition settled instantly and the checks below it then
    // raced the takeoffs fetch, reading "no total yet" as a hard FAIL; against dev the same
    // race existed but extra framework overhead (on-demand compilation, HMR bootstrap) made
    // the real fetch+filter usually — not reliably — win the race by the time the checks ran,
    // so the exact same bug read as a false PASS there. Nothing about the underlying feature
    // differed between the two modes; only how much slack the vacuous wait happened to leave
    // before the real work finished. Waiting for the total match count to actually reach
    // `afterWindTotal` (the number an interactive selection just produced) instead settles on
    // the real signal — it cannot resolve until the fresh navigation has actually fetched,
    // filtered, and rendered the shared link's data, so it can't produce a false pass either.
    const sharedUrl = new URL(url)
    sharedUrl.searchParams.set('wind', 'N')
    await page.goto(sharedUrl.toString(), { waitUntil: 'domcontentloaded' })
    const sharedSettled = await page
      .waitForFunction(
        (expectedTotal) => {
          const match = document.body.textContent?.match(/of (\d+) matches/)
          return match !== null && match !== undefined && Number(match[1]) === expectedTotal
        },
        afterWindTotal,
        { timeout: 20000 },
      )
      .then(() => true)
      .catch(() => false)
    report(
      sharedSettled,
      `opening the shared ${sharedUrl} link directly reaches the same filtered total (${afterWindTotal}) an interactive selection just produced, within the timeout`,
    )
    if (sharedSettled) {
      // Distinct from the total-match assertion above, and allowed to diverge from it in
      // principle (a user only ever sees the rendered rows, not this control's own value) —
      // but pinned here too because it IS user-visible, and because it's now backed by a real
      // mechanism (see index.tsx's WIND_SELECT_SYNC_SCRIPT) rather than an assumption that
      // React's hydration would sort it out on its own, which it does not: a controlled
      // <select> whose client-computed value differs from what the server rendered is never
      // resynced by hydration alone (no warning, no correction — confirmed empirically against
      // both dev and a real build, independent of the settle-condition bug above).
      const sharedSelectValue = await page.evaluate(
        () => (document.querySelector('select[aria-label="Wind direction"]') as HTMLSelectElement | null)?.value,
      )
      report(sharedSelectValue === 'N', `the wind <select> is pre-seeded to N from the URL, not left at "Any wind" (got: ${sharedSelectValue})`)
    }
  }

  // #12: geolocation denial is a normal path in a REAL browser too, not simulated — Chromium
  // under Playwright auto-denies an ungranted permission request instead of hanging on a
  // dialog, which exercises the same PERMISSION_DENIED branch a real user's "Block" click
  // would. The directory must stay visibly usable, not fall into an error state.
  const beforeNearbyCount = await page.evaluate(() => document.querySelectorAll('li').length)
  // The checkbox's real accessible name is "Sort by distance from me" (see index.tsx) — it has
  // never contained the word "nearby", so this locator has never actually matched anything;
  // every run of this script has crashed here with an uncaught locator timeout, pre-existing
  // and unrelated to the wind-filter fix above. Matching on the text the label actually renders.
  await page.getByRole('checkbox', { name: /distance/i }).check()
  const deniedSettled = await page
    .waitForFunction(() => document.body.textContent?.includes('Location permission denied'), { timeout: 10000 })
    .then(() => true)
    .catch(() => false)
  report(deniedSettled, 'checking "Nearby" without a granted permission shows the denial hint within the timeout, not a hang')
  if (deniedSettled) {
    const afterNearbyCount = await page.evaluate(() => document.querySelectorAll('li').length)
    report(
      afterNearbyCount === beforeNearbyCount,
      `the directory stays exactly as usable after a denied permission (rows before: ${beforeNearbyCount}, after: ${afterNearbyCount}) — not an error state`,
    )
    report(!(await mainText()).toLowerCase().includes('error'), 'no "error" text rendered for a declined permission')
  }

  report(badResponses.length === 0, `no unexpected 4xx/5xx responses (saw: ${badResponses.length ? badResponses.join('; ') : 'none'})`)
  report(pageErrors.length === 0, `no uncaught page errors (saw: ${pageErrors.length ? pageErrors.join('; ') : 'none'})`)
}

await browser.close()

if (!overallOk) {
  console.error('FAIL - takeoffs directory browser assertion did not pass')
  process.exit(1)
}
console.log('PASS - takeoffs directory browser assertion passed')
