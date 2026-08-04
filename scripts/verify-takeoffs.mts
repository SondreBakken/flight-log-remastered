import { chromium, type Page } from 'playwright'
import { TAKEOFF_ROW_COUNT_EXPECTATIONS } from './lib/curated-country-expectations'
import { formatRange, inRange } from './lib/range'
import { createReporter } from './lib/verify-report'
import { waitForCondition } from './lib/verify-settle'

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

// This script reads numbers off a REAL BUILD's LIVE fetch of flightlog.org, not off
// fixtures/takeoffs-160.html directly — see the README's "Frozen pins vs. live pins" section
// for the general rule. TOTAL_TAKEOFF_COUNT_RANGE is imported, shared verbatim with
// check-takeoffs-prerender.mts and verify-sites-map.mts (#55): all three bound the same
// real-world quantity (Norway's live takeoff count), so it's declared once
// (scripts/lib/curated-country-expectations.ts) rather than copy-pasted three times with a
// comment asserting the copies agree.
const NORWAY_COUNTRY_ID = 160
const TOTAL_TAKEOFF_COUNT_RANGE = TAKEOFF_ROW_COUNT_EXPECTATIONS.find((e) => e.countryId === NORWAY_COUNTRY_ID)!.rowCountRange
// A single common letter, not a fixed digit or place name — chosen only for matching more than
// MAX_RENDERED_RESULTS takeoffs in the real live dataset (needed below to make the truncation
// notice actually render), a property that holds regardless of which real takeoffs exist or get
// added over time.
const BROAD_QUERY = 'a'
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

// Navigates fresh to the directory with `?wind=<octant>` and reads the total match count the
// truncation notice renders for it — the Node-side half of the shareable-link proof, reused
// once per octant compared below (see the #49-mutation comment at its call site for why more
// than one octant is compared).
async function readSharedWindTotal(page: Page, baseUrl: string, octant: string): Promise<number | null> {
  const target = new URL(baseUrl)
  target.searchParams.set('wind', octant)
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded' })
  const rendered = await waitForCondition(page, () => /of \d+ matches/.test(document.body.textContent ?? ''), 20000)
  return rendered ? readTotalMatchCount(page) : null
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
const settled = await waitForCondition(
  page,
  () => {
    const text = document.body.textContent ?? ''
    return /\d+ takeoffs/.test(text) || text.includes('request failed') || text.includes('timed out waiting for a response')
  },
  20000,
)
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
    renderedRowCount !== null && inRange(renderedRowCount, TOTAL_TAKEOFF_COUNT_RANGE),
    `renders the real fetched row count within the expected ${formatRange(TOTAL_TAKEOFF_COUNT_RANGE)} band, not a hardcoded placeholder or a wildly wrong number (rendered: "${initialText.trim()}")`,
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
  const filteredSettled = await waitForCondition(page, () => document.querySelector('main')?.textContent?.includes('Bodø'), 10000)
  const filteredText = await mainText()
  console.log('rendered <main> text (filtered "Bodo"):', filteredText)
  report(filteredSettled, `typing the plain-ASCII query "Bodo" into the real input finds "Bodø" in the real rendered rows (rendered: "${filteredText.trim()}")`)
  // "Bodo" narrows to well under MAX_RENDERED_RESULTS matches, so no truncation notice renders
  // at all for it ("of X matches" text is truncated-view-only, see index.tsx) — a
  // `filteredTotal !== renderedRowCount` check against THIS query previously compared `null
  // !== renderedRowCount`, trivially true forever regardless of whether filtering narrowed
  // anything (#55: this branch made the vacuity visible in the script's own output; it did not
  // introduce it). BROAD_QUERY proves the real behaviour instead: chosen specifically to match
  // more than MAX_RENDERED_RESULTS takeoffs, so the truncation notice actually renders and
  // there is a real number to compare.
  await page.getByRole('textbox', { name: /takeoff name/i }).fill(BROAD_QUERY)
  const broadQuerySettled = await waitForCondition(page, () => /of \d+ matches/.test(document.body.textContent ?? ''), 10000)
  report(
    broadQuerySettled,
    `typing the broad query "${BROAD_QUERY}" renders a truncation notice within the timeout (i.e. it matches well over ${MAX_RENDERED_RESULTS} real takeoffs)`,
  )
  if (broadQuerySettled) {
    const broadQueryTotal = await readTotalMatchCount(page)
    report(
      broadQueryTotal !== null && broadQueryTotal !== renderedRowCount,
      `the truncation notice reflects the narrowed match count (${broadQueryTotal}), not the original unfiltered total (${renderedRowCount}), once a broad query is typed`,
    )
  }

  // #12: a real wind-direction selection, through the real <select>, against the real live
  // Norway dataset — not a unit test calling selectVisibleTakeoffs directly. Reads the TOTAL
  // match count from the truncation notice, not the rendered <li> count: both the unfiltered
  // view and a single-direction filter comfortably exceed the 200-row cap, so the rendered
  // count alone would stay pinned at 200 either way and could never catch a broken filter.
  //
  // Gated on renderedRowCount !== null: with no valid baseline, the "clear query, wait for the
  // total to return to renderedRowCount" step below would wait on a predicate that can never be
  // satisfied — previously with no `.catch`, which meant a real 10s Playwright timeout rejected
  // UNCAUGHT and killed the script before `finish()` ever ran (#55), so every assertion after it
  // silently never printed instead of reporting FAIL.
  if (renderedRowCount !== null) {
    await page.getByRole('textbox', { name: /takeoff name/i }).fill('')
    const clearedBackToTotal = await page
      .waitForFunction(
        (expected) => {
          const match = document.body.textContent?.match(/of (\d+) matches/)
          return match !== null && Number(match[1]) === expected
        },
        renderedRowCount,
        { timeout: 10000 },
      )
      .then(() => true)
      .catch(() => false)
    report(clearedBackToTotal, `clearing the query returns the total match count to the original ${renderedRowCount} within the timeout`)

    if (clearedBackToTotal) {
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

        // Shareable link, proven end to end: navigating fresh to a ?wind= URL — not "whatever
        // total the interactive selection above happened to produce", which only proves the two
        // paths agree with EACH OTHER, not that either is correct.
        //
        // Settling on ANY `<li>` in the page (the original condition here, pre-#55) is vacuous:
        // the site nav (see src/components/site-nav) renders its own `<li>` items from the very
        // first paint, long before the takeoffs fetch even starts or the wind filter applies —
        // so that wait resolved instantly regardless of whether this feature works, and the
        // checks below it then read the DOM before the real content existed. The exact same bug
        // read as a hard FAIL against a build and a false PASS against dev, purely from how much
        // slack each mode's own overhead left before the vacuous wait resolved (see README.md).
        const sharedUrl = new URL(url)
        sharedUrl.searchParams.set('wind', 'N')
        await page.goto(sharedUrl.toString(), { waitUntil: 'domcontentloaded' })

        const sharedContentRendered = await waitForCondition(page, () => /of \d+ matches/.test(document.body.textContent ?? ''), 20000)
        report(
          sharedContentRendered,
          `opening the shared ${sharedUrl} link renders a filtered match count within the timeout, instead of hanging on "Loading takeoffs…"`,
        )
        if (sharedContentRendered) {
          const sharedTotalN = await readTotalMatchCount(page)

          // Distinct from the total-match assertion below, and allowed to diverge from it in
          // principle (a user only ever sees the rendered rows, not this control's own value) —
          // but pinned here too because it IS user-visible, and because it's now backed by a
          // real mechanism (see index.tsx's mount effect) rather than an assumption that
          // React's hydration would sort it out on its own, which it does not: a controlled
          // <select> whose client-computed value differs from what the server rendered is never
          // resynced by hydration alone (no warning, no correction).
          const sharedSelectValue = await page.evaluate(
            () => (document.querySelector('select[aria-label="Wind direction"]') as HTMLSelectElement | null)?.value,
          )
          report(sharedSelectValue === 'N', `the wind <select> is pre-seeded to N from the URL, not left at "Any wind" (got: ${sharedSelectValue})`)

          // #49's mutation hardcoded the wind predicate to always return SE's matches, whatever
          // octant was actually requested — every requested octant then produced the SAME
          // total, which read as a full PASS against an absolute band picked around N's own
          // count (this file's old WIND_N_RANGE). #55's own arithmetic rules out fixing that by
          // narrowing the band: E sits only 15 above N in the live dataset (1865 vs 1850), so
          // any band around N with real organic-growth headroom necessarily contains E too.
          // What a filter broken the same way on every request CANNOT fake is different octants
          // producing DIFFERENT totals — that's what's asserted below, needing no pinned number
          // and never drifting as Norway's dataset grows. E (a NEAR wind neighbour of N, chosen
          // because a subtly wrong filter is the most likely to still separate N from something
          // FAR away while staying accidentally close to something near) and SW (the octant
          // farthest from N's total in the live dataset) are both compared against N, and
          // against each other, so the property holds pairwise, not just against one anchor.
          const sharedTotalE = await readSharedWindTotal(page, url, 'E')
          const sharedTotalSW = await readSharedWindTotal(page, url, 'SW')
          report(
            sharedTotalN !== null && sharedTotalE !== null && sharedTotalSW !== null,
            `opening the shared link for N, E and SW each render a total within the timeout (N: ${sharedTotalN}, E: ${sharedTotalE}, SW: ${sharedTotalSW})`,
          )
          report(
            sharedTotalN !== sharedTotalE,
            `N and E (a NEAR wind neighbour) produce DIFFERENT totals — a filter broken the same way for every octant cannot fake this (N: ${sharedTotalN}, E: ${sharedTotalE})`,
          )
          report(
            sharedTotalN !== sharedTotalSW,
            `N and SW (a FAR wind neighbour) produce DIFFERENT totals (N: ${sharedTotalN}, SW: ${sharedTotalSW})`,
          )
          report(
            sharedTotalE !== sharedTotalSW,
            `E and SW produce DIFFERENT totals too, so the property holds pairwise across all three, not just against N (E: ${sharedTotalE}, SW: ${sharedTotalSW})`,
          )
          // A loose sanity floor/ceiling underneath the difference property above — not the
          // guarantee itself (see the comment above), just a backstop against an absurd total
          // (zero, or the whole unfiltered set) that would technically differ from the others
          // but still be obviously wrong. Anchored to renderedRowCount (the live total
          // established above, itself already checked against TOTAL_TAKEOFF_COUNT_RANGE), not
          // a second hardcoded literal, so it never needs touching as Norway's dataset grows.
          const octantTotals: readonly [string, number | null][] = [
            ['N', sharedTotalN],
            ['E', sharedTotalE],
            ['SW', sharedTotalSW],
          ]
          for (const [octant, total] of octantTotals) {
            report(
              total !== null && total > 0 && total < renderedRowCount,
              `${octant}'s total (${total}) is a real, non-absurd subset of the unfiltered total (${renderedRowCount}), not zero and not the whole dataset`,
            )
          }
        }
      }
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
  const deniedSettled = await waitForCondition(page, () => document.body.textContent?.includes('Location permission denied'), 10000)
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
