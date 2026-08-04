import { chromium } from 'playwright'
import { FLOWN_SITES_LAYER_ID, FLOWN_SITES_SOURCE_ID } from '../src/components/flown-sites-map/site-layer-ids'
import { createReporter } from './lib/verify-report'
import { collectPageDiagnostics, waitForMapSettled, waitForPaintIdle } from './lib/verify-settle'

// #76's flown-sites map, driven against a REAL browser and pilot 4549's LIVE page (same
// "a green build proves nothing about a map in this repo" reasoning verify-sites-map.mts's own
// doc comment gives — see that file, and README's `verify-*.mts` section, for the general
// pattern this follows). `?__verifyMap` opts into flown-sites-map/index.tsx's
// window.__flownSitesMap/__flownSitesMapData debug handles, gated the same way
// map-debug.ts's isMapDebugEnabled documents. Run against `pnpm run build && pnpm run start`,
// matching every other map-asserting verify script in this repo (never `pnpm dev` — see
// verify-sites-map.mts's own doc comment on why dev's extra overhead can mask real timing bugs).
//
// Pilot 4549's LIVE logbook may differ from fixtures/pilot-4549.html by the time this runs (new
// flights logged since the fixture was scraped) — every assertion below checks a STRUCTURAL
// invariant (the page's own summary line agrees with the map's own live data; a matched site is
// never plotted without a corresponding summary count; an unmatched name is never claimed
// without being listed), never a fixture-frozen count. check:parsers pins the exact 22
// matched / 9 unmatched split against the frozen fixture pair instead — see its own #76 comment.
//
// This script is meant to exercise the 'loaded' state (with both matched sites AND unmatched
// omissions — pilot 4549 is deliberately the acceptance-criterion-3 case: real foreign flights
// this app's curated dataset cannot resolve). The 'error' (dataset/logbook fetch failure) and
// 'no-flights' states are unit-covered only (browse-flown-sites-map/index.test.tsx), and are
// FAILURES here if they show up live (see the failedToLoad/noFlights handling below) — pilot
// 4549 is known to have real flights, so hitting either state live means this run did not verify
// what it exists to verify, not that there is nothing further to check.
const url = process.argv[2] ?? 'http://localhost:3000/pilots/4549?__verifyMap'

const { report: reportRaw, finish } = createReporter()

// F6: a truncated run — an early return, a swallowed exception, a branch that silently skips
// the rest of the script — must not exit 0 just because every assertion that DID run happened
// to pass. Per #106's "fail loudly on a subjectless scan" precedent (check-verify-waits.mts),
// every report() call is counted; a floor on that count is asserted at the very end.
let assertionCount = 0
function report(ok: boolean, label: string): void {
  assertionCount += 1
  reportRaw(ok, label)
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })

// #47-style review gap this repo has been burned by before (see verify-sites-map.mts's own
// negative-gate check): only ever exercising the `?__verifyMap` URL would leave a gate
// degraded to `if (true)` (window.__flownSitesMap always exposed) completely invisible. Runs
// first, in its own throwaway page, so it cannot leave state the main run below depends on.
const baseUrl = url.split('?')[0]
const negativePage = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
await negativePage.goto(baseUrl, { waitUntil: 'domcontentloaded' })
// F2: applies the #95 fix from verify-track-gradient.mts's own negative probe verbatim.
// "the handle stays undefined" is only meaningful if the section had a chance to render first —
// a .catch(() => {})-swallowed wait followed by asserting the handle is undefined is trivially
// true on a page that never rendered at all (confirmed against a stub that never resolves the
// text: the old code still passed). Consumes the wait's own boolean and fails BY NAME when the
// page never rendered, instead of silently falling through to a vacuous pass.
const negativeSectionSettled = await negativePage
  .getByText(/sites mapped|flown sites will appear|could not be loaded/)
  .first()
  .waitFor({ timeout: 20000 })
  .then(() => true)
  .catch(() => false)
if (!negativeSectionSettled) {
  report(
    false,
    "the negative probe's page never rendered the flown-sites section, within the timeout (cannot prove the gate's negative direction on a page that never rendered)",
  )
} else {
  await negativePage.waitForTimeout(1000)
  const handleExposedWithoutParam = await negativePage.evaluate(() => window.__flownSitesMap !== undefined)
  report(!handleExposedWithoutParam, 'window.__flownSitesMap stays undefined on an ordinary navigation without ?__verifyMap (the gate\'s negative direction)')
}
await negativePage.close()

const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const { logs, bad } = collectPageDiagnostics(page)

await page.goto(url, { waitUntil: 'domcontentloaded' })

// The section streams in behind its own <Suspense> (page.tsx) — wait for ANY of its three
// possible states to actually render before asserting on which one showed up.
const sectionSettled = await page
  .getByText(/sites mapped|flown sites will appear|could not be loaded/)
  .first()
  .waitFor({ timeout: 20000 })
  .then(() => true)
  .catch(() => false)
report(sectionSettled, 'the flown-sites section resolves to one of its three states within the timeout')

if (sectionSettled) {
  const bodyText = await page.evaluate(() => document.body.textContent ?? '')
  const failedToLoad = bodyText.includes('Flown sites could not be loaded')
  const noFlights = bodyText.includes('flown sites will appear once this pilot has logged flights')

  // F1: this script's whole job is verifying pilot 4549's LOADED state live — a page that failed
  // to load, or that (surprisingly) has zero flights, is not distinguishable from success by exit
  // code if these branches merely log a note and let the run pass. Named failures instead.
  if (failedToLoad) {
    report(
      false,
      'pilot 4549 (known to have real flights) hit the error state live instead of the loaded state — this run did not verify what it exists to verify',
    )
  } else if (noFlights) {
    report(
      false,
      'pilot 4549 (known to have real flights) hit the no-flights state live instead of the loaded state — this run did not verify what it exists to verify',
    )
  } else {
    const summaryMatch = bodyText.match(/(\d+) sites? mapped(?:, (\d+) takeoffs? could not be located)?/)
    report(summaryMatch !== null, `the summary line matches "N site(s) mapped[, M takeoff(s) could not be located]" (body text: ${bodyText.includes('sites mapped') ? 'contains "sites mapped"' : 'MISSING "sites mapped"'})`)

    const matchedCount = summaryMatch ? Number(summaryMatch[1]) : -1
    const unmatchedCount = summaryMatch?.[2] ? Number(summaryMatch[2]) : 0

    // F5's two independent name lists, gathered as each branch below naturally produces them:
    // matched names once the map settles (matchedCount > 0 only — sites.length is 0 by
    // construction otherwise, see join-flown-sites.ts), unmatched names from the list container
    // regardless of matchedCount. Both feed the logbook cross-check after this if/else.
    let matchedNames: string[] = []
    let unmatchedNamesFromList: string[] = []

    // Acceptance criterion 1, live: an unmatched takeoff is a counted AND named omission —
    // both halves checked against the same live page, not just the count in isolation.
    if (unmatchedCount > 0) {
      report(bodyText.includes('Takeoffs that could not be located:'), 'the unmatched-takeoffs list header renders when unmatchedCount > 0')
      // F4: scoped to the unmatched-list container (data-testid, browse-flown-sites-map/
      // index.tsx), not document.body.textContent — a page-wide read was previously accurate
      // only by coincidence (nothing else on this page happens to also render "(N flight(s))"
      // text today, but nothing enforced that). Renamed from the old generic `listItems` (which
      // actually held the whole body's text, not "list items") to say what it now holds.
      const unmatchedListText = await page.evaluate(
        () => document.querySelector('[data-testid="unmatched-takeoffs"]')?.textContent ?? '',
      )
      const flightCountMentions = (unmatchedListText.match(/\(\d+ flights?\)/g) ?? []).length
      report(
        flightCountMentions === unmatchedCount,
        `the unmatched list renders exactly ${unmatchedCount} entries (found ${flightCountMentions} "(N flight(s))" markers)`,
      )
      // F5's unmatched half: each <li>'s own name, split off before its own " — " separator (an
      // em dash, not a hyphen — see browse-flown-sites-map/index.tsx's UnmatchedTakeoffs).
      unmatchedNamesFromList = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid="unmatched-takeoffs"] li')).map(
          (li) => (li.textContent ?? '').split(' — ')[0]?.trim() ?? '',
        ),
      )
    }

    if (matchedCount === 0) {
      // Acceptance criterion 3, live: zero matched sites must never render an empty map
      // presented as truth.
      report(bodyText.includes('No sites could be mapped for this pilot'), 'zero matched sites renders the prominent omission placeholder, not a blank map')
      const handleStaysUndefined = await page.evaluate(() => window.__flownSitesMap === undefined)
      report(handleStaysUndefined, 'no map instance mounts at all when zero sites matched')
    } else {
      const settled = await waitForMapSettled(page, { handle: '__flownSitesMap', sourceId: FLOWN_SITES_SOURCE_ID })
      report(settled, 'the map settles: window.__flownSitesMap exists and its flown-sites source finished loading, within the timeout')

      if (settled) {
        // F3: isSourceLoaded only proves the GeoJSON parsed and indexed, not that MapLibre has
        // actually PAINTED a frame with it — same #47/#93 precedent as verify-track-hover.mts's
        // and verify-sites-map.mts's own waitForPaintIdle call, applied here before the
        // queryRenderedFeatures read below, which otherwise risks reading a layer that hasn't
        // painted its first frame yet.
        await waitForPaintIdle(page, { handle: '__flownSitesMap', tailMs: 500 })

        const mapData = await page.evaluate(() => window.__flownSitesMapData ?? null)
        if (!mapData) {
          report(false, 'window.__flownSitesMapData is present after settling (it is the data the map was actually built from)')
        } else {
          // Self-consistency between three independent readings of "how many matched sites":
          // the summary line's own N, the GeoJSON data the map was built from, and the
          // rendered marker count MapLibre actually painted.
          report(
            mapData.features.length === matchedCount,
            `the map's own source data carries exactly ${matchedCount} features, matching the summary line (got ${mapData.features.length})`,
          )
          const renderedMarkerCount = await page.evaluate(
            (layerId) => window.__flownSitesMap!.queryRenderedFeatures(undefined, { layers: [layerId] }).length,
            FLOWN_SITES_LAYER_ID,
          )
          report(
            renderedMarkerCount === matchedCount,
            `MapLibre actually renders exactly ${matchedCount} markers on screen, matching the summary line (got ${renderedMarkerCount})`,
          )
          // No placeholder/corrupt coordinate ever reaches the plotted set — same guard
          // verify-sites-map.mts pins for the takeoffs directory map, since join-flown-sites.ts
          // is meant to exclude these via hasKnownLocation before a site ever becomes "matched".
          const corruptPlotted = mapData.features.filter((f) => {
            const [lon, lat] = f.geometry.coordinates
            return lon === 0 || lat === 0 || (Math.abs(lon) < 5 && Math.abs(lat) < 5)
          })
          report(corruptPlotted.length === 0, `no plotted marker sits at a placeholder or corrupt coordinate (found ${corruptPlotted.length})`)

          matchedNames = mapData.features.map((f) => f.properties.name)
        }
      }
    }

    // F5: a cross-check against summary-under-reporting, NOT a structurally guaranteed
    // invariant — read this as a pilot-4549-shaped heuristic, not a proof. flight-row.tsx (the
    // logbook table on this SAME page, PilotLogbook — see its own data-testid="flight-takeoff")
    // renders every flight's own `takeoff` display name, entirely independently of this
    // section's join. `matchedNames` below, though, is NOT that same display name — it's
    // mapData.features[].properties.name, i.e. FlownSite.name, which join-flown-sites.ts's
    // addMatchedFlight sets from the CURATED TAKEOFF DATASET's own `takeoff.name` field (the
    // canonical name the map's own markers/popups must show), not from any flight's own
    // `takeoff` text. The two are expected to read the same in practice, but nothing enforces
    // it, and three real shapes break a naive set-size comparison with no join bug at all:
    //   - two DISTINCT takeoffIds (different sites, possibly different countries) that happen
    //     to share an identical dataset name or an identical logbook display name;
    //   - one site RENAMED between when older flights were logged and now, so the logbook table
    //     shows two different display-text variants for what the join still correctly resolves
    //     to a single matched site or a single unmatched group (see join-flown-sites.ts's own
    //     addUnmatchedFlight comment on this exact same "last write wins" surface for the
    //     unmatched side);
    //   - a takeoff whose dataset `name` and this pilot's own recorded `takeoff` text have
    //     simply always differed (spelling, punctuation) — no fixture on hand shows this, but
    //     nothing guarantees it can't happen, the same "no fixture yet, not confirmed absent"
    //     caveat statistics.ts's breakdownBySite doc comment gives for the same kind of gap.
    // When this goes red: check whether check:parsers' own frozen fixture-vs-fixture pin (its
    // own #76 section) also disagrees before assuming a live regression — a live-only failure
    // with check:parsers still green points at one of the three naming-drift shapes above, not
    // a join bug; the failure message below prints both full name lists so the actual drift is
    // visible without re-running anything.
    const tableTakeoffNames = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="flight-takeoff"]')).map((el) => el.textContent ?? ''),
    )
    // The table's own null-takeoff placeholder ('—', flight-row.tsx) and the join's own
    // null-takeoff placeholder ('Unknown takeoff', join-flown-sites.ts's UNKNOWN_TAKEOFF) are two
    // different strings for the same underlying fact (flight.takeoff === null) — normalized to
    // the join's own spelling here so the two independent sources can be compared on equal terms.
    const NO_TAKEOFF_CELL_TEXT = '—'
    const distinctTableNames = new Set(
      tableTakeoffNames.map((name) => (name === NO_TAKEOFF_CELL_TEXT ? 'Unknown takeoff' : name)),
    )
    const distinctSectionNames = new Set([...matchedNames, ...unmatchedNamesFromList])
    report(
      distinctTableNames.size === distinctSectionNames.size,
      `the logbook table's own ${distinctTableNames.size} distinct takeoff name(s) match the flown-sites section's ${distinctSectionNames.size} distinct matched+unmatched name(s) — a naming-basis heuristic, not a structural guarantee (see this check's own doc comment); got table=${[...distinctTableNames].sort().join('; ')} | section=${[...distinctSectionNames].sort().join('; ')})`,
    )
  }
}

report(bad.length === 0, `no unexpected 4xx/5xx responses or failed requests (saw: ${bad.length ? bad.join('; ') : 'none'})`)
const pageErrors = logs.filter((l) => l.startsWith('[pageerror]'))
const consoleErrors = logs.filter((l) => l.startsWith('[error]'))
report(pageErrors.length === 0, `no uncaught page errors (saw: ${pageErrors.length ? pageErrors.join('; ') : 'none'})`)
report(consoleErrors.length === 0, `no console errors, including MapLibre's own 'error' events (saw: ${consoleErrors.length ? consoleErrors.join('; ') : 'none'})`)

// F6: the loaded+matched+unmatched happy path runs 13 report() calls as of this writing (2 in
// the negative probe/section-settle preamble, 1 summary-line match, 2 unmatched-list, 4 matched-
// map, 1 F5 cross-check, 3 diagnostics) — 10 is a floor comfortably below that but well above
// what any early-exit branch (a dead server, an unexpected error/no-flights state, now that F1
// makes those explicit failures) produces on its own, so a script that quietly stopped asserting
// partway through cannot still exit 0.
const MIN_ASSERTION_COUNT = 10
report(
  assertionCount >= MIN_ASSERTION_COUNT,
  `at least ${MIN_ASSERTION_COUNT} assertions ran (ran ${assertionCount}) — a truncated run cannot pass just because everything that DID run happened to pass`,
)

await browser.close()

finish('flown sites browser assertion')
