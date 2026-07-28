import { chromium, type Page } from 'playwright'
import { createReporter } from './lib/verify-report'

// #9's end-to-end proof, superseding #38's row-count-only version: a real browser, navigating
// to the prerendered takeoffs directory, actually issues a network request for the takeoffs
// asset, renders the real fetched count, shows a visible truncation notice for the unfiltered
// view, and narrows to a real match when the user types a folded, diacritic-free query — not
// something baked into the initial HTML, and not a component that ignores its own input.
// Extended by #12 to also prove: a real wind-direction selection narrows the real dataset and
// round-trips through the address bar as a shareable ?wind= link (server-validated, not just a
// client toggle), and a real, un-granted geolocation permission (Chromium auto-denies rather
// than hanging on a dialog) leaves the directory just as usable as before, never an error
// state. Run against `pnpm run build && pnpm run start` (the static artifact this route serves
// only exists after a real build — see check-takeoffs-prerender.mts), never against `pnpm dev`,
// which would re-run `getTakeoffs`/`getRegions` against flightlog.org live.
const url = process.argv[2] ?? 'http://localhost:3000/countries/160/takeoffs'

// Both ranges below bound something this script reads off a REAL BUILD's LIVE fetch of
// flightlog.org, not off fixtures/takeoffs-160.html directly — the fixture only records what
// this looked like at curation time (6012 rows total, 1849 with wind bit N set). Norway's live
// takeoff count only grows as pilots log new sites, so an exact pin against either number goes
// stale the first time someone logs a takeoff after curation (#55) — see curated-countries.ts's
// doc comment on expectedRowCountRange for the full frozen-vs-live reasoning, which applies
// identically here.
//
// ROW_COUNT_RANGE deliberately matches check-takeoffs-prerender.mts's expectedRowCountRange for
// country 160 — both bound the same real-world quantity (Norway's live takeoff count).
const ROW_COUNT_RANGE = [5500, 9000] as const
// WIND_N_RANGE is a band, not a wider exact pin, but it is still an ABSOLUTE pin, not a
// comparison between two live-computed numbers (#49's own distinction, unchanged by #55): a
// filter that's broken THE SAME WAY on every code path (e.g. always returning some other
// direction's matches, or the whole unfiltered set) would still "agree with itself" under a
// two-paths comparison and pass, landing nowhere near 1849 either way — only a band fixed
// outside the app, wide enough for organic growth but nowhere near the unfiltered total, can
// catch that. Scaled from the fixture's observed ~30.75% of rows carrying wind bit N, over the
// same growth headroom ROW_COUNT_RANGE allows.
const WIND_N_RANGE = [1600, 2600] as const
const MAX_RENDERED_RESULTS = 200 // select-visible-takeoffs.ts's own cap

const { report, finish } = createReporter()

// The `/of (\d+) matches/` truncation-notice total, read from the page — the one place this
// script learns the app's actual filtered count, used everywhere a Node-side value (not a
// browser-side wait predicate) is needed.
async function readTotalMatchCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const match = document.body.textContent?.match(/of (\d+) matches/)
    return match ? Number(match[1]) : null
  })
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
  // Extracted via regex, not a substring match against a fixed number (#55): the row count
  // this page renders comes from a real build's live fetch of flightlog.org, which grows over
  // time, so what this script can pin is "a real, sane number rendered," not "this exact digit
  // string appears."
  const renderedRowCountMatch = initialText.match(/(\d+) takeoffs/)
  const renderedRowCount = renderedRowCountMatch ? Number(renderedRowCountMatch[1]) : null
  report(
    renderedRowCount !== null && renderedRowCount >= ROW_COUNT_RANGE[0] && renderedRowCount <= ROW_COUNT_RANGE[1],
    `renders the real fetched row count within the expected ${ROW_COUNT_RANGE[0]}-${ROW_COUNT_RANGE[1]} band, not a hardcoded placeholder or a wildly wrong number (rendered: "${initialText.trim()}")`,
  )
  // Self-consistency against renderedRowCount, not a second band check against the same
  // literal: this assertion's job is "the truncation notice's own total agrees with the count
  // rendered above," a failure mode (two UI elements disagreeing about the same live number)
  // the band check above cannot see, since both would independently pass if only one drifted.
  const truncationMatch = initialText.match(new RegExp(`Showing ${MAX_RENDERED_RESULTS} of (\\d+) matches`))
  const truncationTotal = truncationMatch ? Number(truncationMatch[1]) : null
  report(
    truncationTotal !== null && truncationTotal === renderedRowCount,
    `shows a VISIBLE truncation notice for the unfiltered view, capped to ${MAX_RENDERED_RESULTS} rendered rows, whose total agrees with the row count rendered above (rendered: "${initialText.trim()}")`,
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
    const filteredTotal = await readTotalMatchCount(page)
    report(
      filteredTotal !== renderedRowCount,
      `the truncation notice reflects the narrowed match count (${filteredTotal}), not the original unfiltered total (${renderedRowCount}), once a query is typed`,
    )
  }

  // #12: a real wind-direction selection, through the real <select>, against the real live
  // Norway dataset — not a unit test calling selectVisibleTakeoffs directly. Reads the TOTAL
  // match count from the truncation notice, not the rendered <li> count: both the unfiltered
  // view and a single-direction filter comfortably exceed the 200-row cap, so the rendered
  // count alone would stay pinned at 200 either way and could never catch a broken filter.
  // Cleared query first so this measures the wind filter alone, not query+wind together. Waits
  // for the total to return to renderedRowCount (established above, already in-band), not a
  // hardcoded digit string (#55) — same live-total reasoning as everywhere else in this file.
  await page.getByRole('textbox', { name: /takeoff name/i }).fill('')
  await page.waitForFunction(
    (expected) => {
      const match = document.body.textContent?.match(/of (\d+) matches/)
      return match !== null && Number(match[1]) === expected
    },
    renderedRowCount,
    { timeout: 10000 },
  )
  const beforeWindTotal = await readTotalMatchCount(page)
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
    const afterWindTotal = await readTotalMatchCount(page)
    report(
      typeof afterWindTotal === 'number' && afterWindTotal < (beforeWindTotal ?? Infinity),
      `narrows the total match count, not widens it (before: ${beforeWindTotal}, after: ${afterWindTotal})`,
    )
    report(
      new URL(page.url()).searchParams.get('wind') === 'N',
      `updates the address bar to a shareable ?wind=N (url: ${page.url()})`,
    )

    // Shareable link, proven end to end: navigating fresh to that exact URL renders N's own
    // pinned band (WIND_N_RANGE) — not "whatever total the interactive selection above happened
    // to produce", which only proves the two paths agree with EACH OTHER, not that either is
    // correct (see WIND_N_RANGE's own doc comment on why this stays an absolute pin, per #49).
    //
    // Settling on ANY `<li>` in the page (the original condition here) is vacuous: the site
    // nav (see src/components/site-nav) renders its own `<li>` items from the very first
    // paint, long before the takeoffs fetch even starts or the wind filter applies — so that
    // wait resolved instantly regardless of whether this feature works, and the checks below
    // it then read the DOM before the real content existed. The exact same bug read as a hard
    // FAIL against a build and a false PASS against dev, purely from how much slack each
    // mode's own overhead left before the vacuous wait resolved (see README.md).
    const sharedUrl = new URL(url)
    sharedUrl.searchParams.set('wind', 'N')
    await page.goto(sharedUrl.toString(), { waitUntil: 'domcontentloaded' })

    // Waits only for A total to render, never for it to fall in WIND_N_RANGE — folding the
    // band check into the wait would turn a wrong total into an indistinguishable 20-second
    // timeout that reports only the band it expected, never what actually rendered. "The
    // shared link never loaded" and "the shared link loaded the wrong total" are different
    // failures; the assertion below reports the second one by name.
    const sharedContentRendered = await page
      .waitForFunction(() => /of \d+ matches/.test(document.body.textContent ?? ''), { timeout: 20000 })
      .then(() => true)
      .catch(() => false)
    report(
      sharedContentRendered,
      `opening the shared ${sharedUrl} link renders a filtered match count within the timeout, instead of hanging on "Loading takeoffs…"`,
    )
    if (sharedContentRendered) {
      const sharedTotal = await readTotalMatchCount(page)
      report(
        sharedTotal !== null && sharedTotal >= WIND_N_RANGE[0] && sharedTotal <= WIND_N_RANGE[1],
        `opening the shared ${sharedUrl} link directly reaches N's pinned band of ${WIND_N_RANGE[0]}-${WIND_N_RANGE[1]} (rendered: ${sharedTotal})`,
      )

      // Distinct from the total-match assertion above, and allowed to diverge from it in
      // principle (a user only ever sees the rendered rows, not this control's own value) —
      // but pinned here too because it IS user-visible, and because it's now backed by a real
      // mechanism (see index.tsx's mount effect) rather than an assumption that React's
      // hydration would sort it out on its own, which it does not: a controlled <select>
      // whose client-computed value differs from what the server rendered is never resynced
      // by hydration alone (no warning, no correction).
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
  // never contained "nearby", so a /nearby/i locator never actually matched it.
  await page.getByRole('checkbox', { name: /distance/i }).check()
  const deniedSettled = await page
    .waitForFunction(() => document.body.textContent?.includes('Location permission denied'), { timeout: 10000 })
    .then(() => true)
    .catch(() => false)
  report(deniedSettled, 'checking "Sort by distance from me" without a granted permission shows the denial hint within the timeout, not a hang')
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

finish('takeoffs directory browser assertion')
