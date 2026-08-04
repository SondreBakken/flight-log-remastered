import { chromium } from 'playwright'
import { FLOWN_SITES_LAYER_ID, FLOWN_SITES_SOURCE_ID } from '../src/components/flown-sites-map/site-layer-ids'
import { createReporter } from './lib/verify-report'
import { collectPageDiagnostics, waitForMapSettled } from './lib/verify-settle'

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
// This script only exercises the 'loaded' state (with both matched sites AND unmatched
// omissions — pilot 4549 is deliberately the acceptance-criterion-3 case: real foreign flights
// this app's curated dataset cannot resolve). The 'error' (dataset/logbook fetch failure) and
// 'no-flights' states are unit-covered only (browse-flown-sites-map/index.test.tsx) — neither
// is reproducible against a live, working flightlog.org without fault-injecting the fetch layer
// itself, which no verify-*.mts script in this repo does.
const url = process.argv[2] ?? 'http://localhost:3000/pilots/4549?__verifyMap'

const { report, finish } = createReporter()

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })

// #47-style review gap this repo has been burned by before (see verify-sites-map.mts's own
// negative-gate check): only ever exercising the `?__verifyMap` URL would leave a gate
// degraded to `if (true)` (window.__flownSitesMap always exposed) completely invisible. Runs
// first, in its own throwaway page, so it cannot leave state the main run below depends on.
const baseUrl = url.split('?')[0]
const negativePage = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
await negativePage.goto(baseUrl, { waitUntil: 'domcontentloaded' })
await negativePage.getByText(/sites mapped|flown sites will appear|could not be loaded/).first().waitFor({ timeout: 20000 }).catch(() => {})
await negativePage.waitForTimeout(1000)
const handleExposedWithoutParam = await negativePage.evaluate(() => window.__flownSitesMap !== undefined)
await negativePage.close()
report(!handleExposedWithoutParam, 'window.__flownSitesMap stays undefined on an ordinary navigation without ?__verifyMap (the gate\'s negative direction)')

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

  if (failedToLoad) {
    console.log('note: pilot 4549 hit the error state live (flightlog.org fetch failed) — nothing further to assert against a live map this run.')
  } else if (noFlights) {
    console.log('note: pilot 4549 has zero live flights this run — nothing further to assert against a live map this run.')
  } else {
    const summaryMatch = bodyText.match(/(\d+) sites? mapped(?:, (\d+) takeoffs? could not be located)?/)
    report(summaryMatch !== null, `the summary line matches "N site(s) mapped[, M takeoff(s) could not be located]" (body text: ${bodyText.includes('sites mapped') ? 'contains "sites mapped"' : 'MISSING "sites mapped"'})`)

    const matchedCount = summaryMatch ? Number(summaryMatch[1]) : -1
    const unmatchedCount = summaryMatch?.[2] ? Number(summaryMatch[2]) : 0

    // Acceptance criterion 1, live: an unmatched takeoff is a counted AND named omission —
    // both halves checked against the same live page, not just the count in isolation.
    if (unmatchedCount > 0) {
      report(bodyText.includes('Takeoffs that could not be located:'), 'the unmatched-takeoffs list header renders when unmatchedCount > 0')
      const listItems = await page.evaluate(() => document.body.textContent ?? '')
      // Every unmatched entry lists its flight count in parens ("(N flights)") — a coarse but
      // real proof the list has as many rendered rows as the summary count claims, without
      // hardcoding any actual name (which the live logbook can add to or drop over time).
      const flightCountMentions = (listItems.match(/\(\d+ flights?\)/g) ?? []).length
      report(
        flightCountMentions === unmatchedCount,
        `the unmatched list renders exactly ${unmatchedCount} entries (found ${flightCountMentions} "(N flight(s))" markers)`,
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
        }
      }
    }
  }
}

report(bad.length === 0, `no unexpected 4xx/5xx responses or failed requests (saw: ${bad.length ? bad.join('; ') : 'none'})`)
const pageErrors = logs.filter((l) => l.startsWith('[pageerror]'))
const consoleErrors = logs.filter((l) => l.startsWith('[error]'))
report(pageErrors.length === 0, `no uncaught page errors (saw: ${pageErrors.length ? pageErrors.join('; ') : 'none'})`)
report(consoleErrors.length === 0, `no console errors, including MapLibre's own 'error' events (saw: ${consoleErrors.length ? consoleErrors.join('; ') : 'none'})`)

await browser.close()

finish('flown sites browser assertion')
