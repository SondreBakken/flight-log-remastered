import { chromium } from 'playwright'

// #10's end-to-end proof that a green build proves nothing about a map in this repo — that has
// literally happened here (a clean build once coexisted with a completely blank one, see
// verify-map.mts's own history). This drives a REAL browser against the prerendered takeoffs
// route, clicks the actual "Map" toggle (so the map only exists once real hydration + a real
// click handler ran — the list view is what's in the static shell, not the map, which closes
// the #9-shaped "settle condition satisfied before hydration" trap), and asserts on live
// MapLibre state via window.__takeoffsMap/__takeoffsMapData (see takeoffs-map.tsx's own doc
// comment on why that handle exists — there's no test runner in this repo driving a real GL
// context). Run against `pnpm run build && pnpm run start`, never `pnpm dev` — same reason
// verify-takeoffs.mts gives: the takeoffs dataset this page fetches only exists as a
// prerendered artifact after a real build.
// `?__verifyMap` opts into takeoffs-map.tsx's window.__takeoffsMap/__takeoffsMapData debug
// handles — see that file's own doc comment on isMapDebugEnabled for why this is a runtime
// query param, not the NODE_ENV gate track-map.tsx uses: `next start` always runs in
// production, unconditionally, which is exactly the mode this route has to be tested under.
const url = process.argv[2] ?? 'http://localhost:3000/countries/160/takeoffs?__verifyMap'

// Norway's full fixture (fixtures/takeoffs-160.html, same one check:takeoffs-prerender and
// verify-takeoffs.mts pin): 6012 rows total, 1948 carrying the lat=0/lon=0 placeholder (#12's
// hazard, reused here rather than rediscovered — see hasKnownLocation in
// select-visible-takeoffs.ts). Exact counts, not a loosened `> 0` or `<=`, so a feature-count
// assertion that quietly accepts an empty or partially-empty source still fails clearly.
const EXPECTED_TOTAL = 6012
const EXPECTED_EXCLUDED = 1948
const EXPECTED_PLOTTED = EXPECTED_TOTAL - EXPECTED_EXCLUDED

let overallOk = true
function report(ok: boolean, label: string): void {
  console.log(`${ok ? 'ok' : 'FAIL'} - ${label}`)
  if (!ok) overallOk = false
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const badResponses: string[] = []
const pageErrors: string[] = []
page.on('response', (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`)
})
page.on('pageerror', (e) => pageErrors.push(e.message))

await page.goto(url, { waitUntil: 'domcontentloaded' })

// The map view is behind a real click on real hydrated React — until this succeeds, nothing
// below can be a false positive off the static shell (which renders the list view only).
const mapButton = page.getByRole('button', { name: 'Map' })
await mapButton.waitFor({ state: 'visible', timeout: 20000 })
await mapButton.click()

await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 }).catch(() => {})

// A DEFINITIVE settle condition: the map instance exists AND its sites source has actually
// finished loading — not just "the canvas element is in the DOM," which the raster tile layer
// alone would already satisfy with the GeoJSON source still empty (the exact class of silent
// failure #10's own issue calls out for maplibre-gl v6/Turbopack).
const settled = await page
  .waitForFunction(
    () => window.__takeoffsMap !== undefined && window.__takeoffsMap.isSourceLoaded('takeoff-sites') === true,
    { timeout: 20000 },
  )
  .then(() => true)
  .catch(() => false)
report(settled, 'the map settles: window.__takeoffsMap exists and its takeoff-sites source finished loading, within the timeout')

if (settled) {
  const mapData = await page.evaluate(() => window.__takeoffsMapData ?? null)
  if (!mapData) {
    report(false, 'window.__takeoffsMapData is present after settling (it is the data the map was actually built from)')
  } else {
    report(mapData.excludedCount === EXPECTED_EXCLUDED, `excludedCount is exactly ${EXPECTED_EXCLUDED} (got ${mapData.excludedCount})`)
    report(mapData.plottedCount === EXPECTED_PLOTTED, `plottedCount is exactly ${EXPECTED_PLOTTED} (got ${mapData.plottedCount})`)
    report(
      mapData.sites.features.length === EXPECTED_PLOTTED,
      `the sites source carries exactly ${EXPECTED_PLOTTED} plotted features, not a loosened or partial count (got ${mapData.sites.features.length})`,
    )
    // No placeholder ever reaches the plotted set, checked directly against the live feature
    // geometry — not just trusting plottedCount's arithmetic.
    const placeholderPlotted = mapData.sites.features.filter((f) => f.geometry.coordinates[0] === 0 && f.geometry.coordinates[1] === 0)
    report(placeholderPlotted.length === 0, `no plotted feature sits at the lat=0/lon=0 placeholder (found ${placeholderPlotted.length})`)

    // The excluded count is not just computed — it must be VISIBLE, per #12/#10's shared rule
    // that excluding is fine, doing it silently is not.
    const legendText = await page.evaluate(() => document.body.textContent ?? '')
    report(
      legendText.includes(`${EXPECTED_EXCLUDED} excluded`) && legendText.includes(`${EXPECTED_PLOTTED} takeoffs plotted`),
      `the excluded count is rendered as VISIBLE text on the page, not just tracked internally (looked for "${EXPECTED_PLOTTED} takeoffs plotted" and "${EXPECTED_EXCLUDED} excluded")`,
    )

    // Both deliberate wind categories are real and present in the actual dataset — not a
    // fixture too tame to exercise them.
    const noneFeatures = mapData.sites.features.filter((f) => f.properties.windCategory === 'none')
    const allFeatures = mapData.sites.features.filter((f) => f.properties.windCategory === 'all')
    const someFeatures = mapData.sites.features.filter((f) => f.properties.windCategory === 'some')
    report(noneFeatures.length > 0, `at least one site classifies as "none" (no recorded wind) — got ${noneFeatures.length}`)
    report(allFeatures.length > 0, `at least one site classifies as "all" (every direction) — got ${allFeatures.length}`)
    report(someFeatures.length > 0, `at least one site classifies as "some" (an ordinary directional reading) — got ${someFeatures.length}`)

    // Neither special category ever contributes a ray — a "some"-shaped rendering for either
    // is exactly what #10's issue rules out ("eight arrows" for all, an invented direction for
    // none).
    const noneOrAllIds = new Set([...noneFeatures, ...allFeatures].map((f) => f.properties.takeoffId))
    const raysOnSpecialSites = mapData.rays.features.filter((f) => noneOrAllIds.has(f.properties.takeoffId))
    report(raysOnSpecialSites.length === 0, `no "none" or "all" site contributes a directional ray (found ${raysOnSpecialSites.length})`)
    report(mapData.rays.features.length > 0, `at least one directional ray exists for a "some" site (got ${mapData.rays.features.length})`)
    // Every ray belongs to a real "some" site — the complete converse of the check above.
    const someIds = new Set(someFeatures.map((f) => f.properties.takeoffId))
    const strayRays = mapData.rays.features.filter((f) => !someIds.has(f.properties.takeoffId))
    report(strayRays.length === 0, `every ray belongs to a "some"-category site (found ${strayRays.length} that don't)`)

    // --- clustering: MapLibre's own built-in support, not manual grouping ---
    // At the initial, whole-country view, thousands of nearby sites must bundle into a
    // handful of cluster circles — if clustering were disabled outright, the cluster layer
    // would render nothing (its own filter, `has(point_count)`, only ever matches
    // supercluster-produced features) while the three unclustered layers would each show
    // close to the full plotted set instead.
    const clustersAtOverview = await page.evaluate(() => window.__takeoffsMap!.queryRenderedFeatures(undefined, { layers: ['takeoff-clusters'] }).length)
    const unclusteredAtOverview = await page.evaluate(() =>
      ['takeoff-site-none', 'takeoff-site-all', 'takeoff-site-some']
        .flatMap((layerId) => window.__takeoffsMap!.queryRenderedFeatures(undefined, { layers: [layerId] }))
        .length,
    )
    report(clustersAtOverview > 0, `clusters actually render at the whole-country overview zoom (got ${clustersAtOverview} cluster features)`)
    report(
      unclusteredAtOverview < EXPECTED_PLOTTED / 2,
      `most sites are bundled into clusters at the overview zoom, not rendered individually (${unclusteredAtOverview} unclustered features rendered, vs ${EXPECTED_PLOTTED} total plotted)`,
    )

    // Zoom in on a real, live "some"-category site (picked from the actual dataset, not a
    // guessed coordinate) — past clusterMaxZoom, so it must render individually, and past
    // RAY_MIN_ZOOM, so its wind ray(s) must render too.
    const sampleSite = someFeatures[0]!
    await page.evaluate((coordinates) => {
      window.__takeoffsMap!.jumpTo({ center: coordinates as [number, number], zoom: 15 })
    }, sampleSite.geometry.coordinates)
    await page.waitForTimeout(500) // let the source re-query and the layer re-render at the new viewport

    const unclusteredAtSite = await page.evaluate(() =>
      ['takeoff-site-none', 'takeoff-site-all', 'takeoff-site-some']
        .flatMap((layerId) => window.__takeoffsMap!.queryRenderedFeatures(undefined, { layers: [layerId] }))
        .length,
    )
    const clustersAtSite = await page.evaluate(() => window.__takeoffsMap!.queryRenderedFeatures(undefined, { layers: ['takeoff-clusters'] }).length)
    const raysAtSite = await page.evaluate(() => window.__takeoffsMap!.queryRenderedFeatures(undefined, { layers: ['wind-ray-lines'] }).length)

    report(unclusteredAtSite > 0, `zoomed in on a real site, individual site markers now render (got ${unclusteredAtSite})`)
    report(clustersAtSite === 0, `zoomed past clusterMaxZoom, nothing renders on the cluster layer any more (got ${clustersAtSite})`)
    report(raysAtSite > 0, `zoomed past the wind-ray minzoom on a real directional site, at least one ray actually renders (got ${raysAtSite})`)
  }
}

report(badResponses.length === 0, `no unexpected 4xx/5xx responses (saw: ${badResponses.length ? badResponses.join('; ') : 'none'})`)
report(pageErrors.length === 0, `no uncaught page errors (saw: ${pageErrors.length ? pageErrors.join('; ') : 'none'})`)

await browser.close()

if (!overallOk) {
  console.error('FAIL - sites map browser assertion did not pass')
  process.exit(1)
}
console.log('PASS - sites map browser assertion passed')
