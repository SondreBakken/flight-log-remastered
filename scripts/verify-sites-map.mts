import { chromium } from 'playwright'
import {
  SITES_SOURCE_ID,
  CLUSTER_LAYER_ID,
  UNCLUSTERED_NONE_LAYER_ID,
  UNCLUSTERED_ALL_LAYER_ID,
  UNCLUSTERED_SOME_LAYER_ID,
  WIND_RAY_LAYER_ID,
} from '../src/components/takeoffs-map/site-layer-ids'
import { RAY_MIN_ZOOM } from '../src/components/takeoffs-map/build-takeoffs-geojson'
import { TAKEOFF_ROW_COUNT_EXPECTATIONS } from './lib/curated-country-expectations'
import { formatRange, inRange } from './lib/range'
import { createReporter } from './lib/verify-report'
import { waitForMapSettled } from './lib/verify-settle'

// #10's end-to-end proof that a green build proves nothing about a map in this repo — that has
// literally happened here (a clean build once coexisted with a completely blank one, see
// verify-map.mts's own history). This drives a REAL browser against the prerendered takeoffs
// route and asserts on live MapLibre state via window.__takeoffsMap/__takeoffsMapData (see
// takeoffs-map.tsx's own doc comment on why that handle exists — there's no test runner in
// this repo driving a real GL context). Run against `pnpm run build && pnpm run start`, never
// `pnpm dev` — same reason verify-takeoffs.mts gives: the takeoffs dataset this page fetches
// only exists as a prerendered artifact after a real build.
//
// The "Map" button clicked below already exists in the PRERENDERED HTML — the static shell
// renders the list view, but the toggle button itself is part of it, not something React adds
// later. So this click can land before hydration finishes; what actually makes it register is
// React's event replay catching up to it once hydration completes, not a wait for some
// "hydrated" state this script never explicitly checks for. The settle condition below (the
// map instance existing AND its source finished loading) is what actually rules out a false
// positive off the static shell, not the click itself.
//
// `?__verifyMap` opts into takeoffs-map.tsx's window.__takeoffsMap/__takeoffsMapData debug
// handles — see that file's own doc comment on isMapDebugEnabled for why this is a runtime
// query param, not the NODE_ENV gate track-map.tsx uses: `next start` always runs in
// production, unconditionally, which is exactly the mode this route has to be tested under.
const url = process.argv[2] ?? 'http://localhost:3000/countries/160/takeoffs?__verifyMap'

// This page's data comes from a REAL BUILD's LIVE fetch of flightlog.org (same as
// check-takeoffs-prerender.mts and verify-takeoffs.mts), not from fixtures/takeoffs-160.html
// directly — see the README's "Frozen pins vs. live pins" section for the general rule; bands,
// not exact counts, still wide enough to fail hard for an empty, near-empty, or still-corrupt
// source (see hasKnownLocation in src/lib/flightlog/has-known-location.ts for what "corrupt"
// means here).
//
// TOTAL_TAKEOFF_COUNT_RANGE is imported, shared verbatim with check-takeoffs-prerender.mts and
// verify-takeoffs.mts — all three bound the same real-world quantity (Norway's live takeoff
// count), so it is declared once (scripts/lib/curated-country-expectations.ts) rather than
// copy-pasted three times with a comment asserting the copies agree (#55). Asserted below
// against excludedCount + plottedCount, not plottedCount alone — that sum IS the total
// (build-takeoffs-geojson.ts's own arithmetic: `excludedCount: takeoffs.length - located.length,
// plottedCount: located.length`), so this is the only assertion in this file that reads the
// total at all. Without it, excludedCount and plottedCount could each independently land in
// their own band while implying an impossible total (e.g. excluded at its ceiling and plotted
// at ITS ceiling summing past TOTAL_TAKEOFF_COUNT_RANGE's own ceiling) and nothing here would
// notice. EXCLUDED_TAKEOFF_COUNT_RANGE is its own band, not derived from the total: corrupt-
// coordinate takeoffs are a subset that can grow at a different rate than the whole (a
// newly-logged takeoff is corrupt or it isn't, independent of how many other takeoffs got
// logged alongside it), so pinning it to the fixture's observed 1955 ± comparable headroom is
// the honest band, not one algebraically forced to agree with the total.
const NORWAY_COUNTRY_ID = 160
const TOTAL_TAKEOFF_COUNT_RANGE = TAKEOFF_ROW_COUNT_EXPECTATIONS.find((e) => e.countryId === NORWAY_COUNTRY_ID)!.rowCountRange
const EXCLUDED_TAKEOFF_COUNT_RANGE = [1700, 2600] as const

const { report, finish } = createReporter()

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
const badResponses: string[] = []
const pageErrors: string[] = []
// MapLibre routes its own 'error' events (source/tile/style failures — the exact class of
// silent GeoJSON-never-loaded failure this whole script exists for, see takeoffs-map.tsx's own
// `map.on('error', ...)` handler) through console.error, not pageerror. Without this, that
// channel is invisible to this script even though the app code already logs to it.
const consoleErrors: string[] = []
page.on('response', (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`)
})
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})

// #47 review gap: only the `?__verifyMap` URL above was ever exercised end-to-end, so nothing
// pinned the gate's NEGATIVE direction — that window.__takeoffsMap stays undefined on an
// ORDINARY navigation, without the param. A call site degraded to `if (true)` (see
// takeoffs-map.tsx) would have stayed green through this whole script and every other check in
// the repo, since every one of them sends the param. Runs first, in its own throwaway page, so
// it cannot leave state the main run below depends on.
const baseUrl = url.split('?')[0]
const negativePage = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
await negativePage.goto(baseUrl, { waitUntil: 'domcontentloaded' })
const negativeMapButton = negativePage.getByRole('button', { name: 'Map' })
await negativeMapButton.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
await negativeMapButton.click().catch(() => {})
await negativePage.waitForSelector('.maplibregl-canvas', { timeout: 20000 }).catch(() => {})
await negativePage.waitForTimeout(1000)
const handleExposedWithoutParam = await negativePage.evaluate(() => window.__takeoffsMap !== undefined)
await negativePage.close()
report(!handleExposedWithoutParam, 'window.__takeoffsMap stays undefined on an ordinary navigation without ?__verifyMap (the gate\'s negative direction)')

await page.goto(url, { waitUntil: 'domcontentloaded' })

const mapButton = page.getByRole('button', { name: 'Map' })
await mapButton.waitFor({ state: 'visible', timeout: 20000 })
await mapButton.click()

await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 }).catch(() => {})

// A DEFINITIVE settle condition: the map instance exists AND its sites source has actually
// finished loading — not just "the canvas element is in the DOM," which the raster tile layer
// alone would already satisfy with the GeoJSON source still empty (the exact class of silent
// failure #10's own issue calls out for maplibre-gl v6/Turbopack).
const settled = await waitForMapSettled(page, { handle: '__takeoffsMap', sourceId: SITES_SOURCE_ID })
report(settled, 'the map settles: window.__takeoffsMap exists and its takeoff-sites source finished loading, within the timeout')

if (settled) {
  const mapData = await page.evaluate(() => window.__takeoffsMapData ?? null)
  if (!mapData) {
    report(false, 'window.__takeoffsMapData is present after settling (it is the data the map was actually built from)')
  } else {
    report(
      inRange(mapData.excludedCount, EXCLUDED_TAKEOFF_COUNT_RANGE),
      `excludedCount falls within the expected ${formatRange(EXCLUDED_TAKEOFF_COUNT_RANGE)} band (got ${mapData.excludedCount})`,
    )
    // excludedCount + plottedCount, not plottedCount alone (see the constant's own doc comment
    // above for why) — this is the only place in this script that reads the total.
    const totalTakeoffCount = mapData.excludedCount + mapData.plottedCount
    report(
      inRange(totalTakeoffCount, TOTAL_TAKEOFF_COUNT_RANGE),
      `excludedCount + plottedCount (${totalTakeoffCount}) falls within the expected ${formatRange(TOTAL_TAKEOFF_COUNT_RANGE)} band for Norway's live takeoff total (excluded ${mapData.excludedCount}, plotted ${mapData.plottedCount})`,
    )
    // Self-consistency, not a second absolute pin: the sites SOURCE and the plottedCount FIELD
    // are two different readings of the same map-build output, taken at the same moment — this
    // catches one disagreeing with the other (say, a source built from a stale or partial list
    // while the count field reports the intended one), a failure shape the band checks above
    // cannot see since both would still land inside the band independently.
    report(
      mapData.sites.features.length === mapData.plottedCount,
      `the sites source carries exactly as many features as plottedCount reports, not a loosened or partial count (plottedCount ${mapData.plottedCount}, features ${mapData.sites.features.length})`,
    )
    // No placeholder, and no corrupt-coordinate row (see hasKnownLocation), ever reaches the
    // plotted set — checked directly against the live feature geometry, not just trusting
    // plottedCount's arithmetic. A real Norwegian/French site is never within a few degrees of
    // Null Island on both axes, and never has exactly one axis at 0.
    const corruptPlotted = mapData.sites.features.filter((f) => {
      const [lon, lat] = f.geometry.coordinates
      return lon === 0 || lat === 0 || (Math.abs(lon) < 5 && Math.abs(lat) < 5)
    })
    report(corruptPlotted.length === 0, `no plotted feature sits at a placeholder or corrupt coordinate (found ${corruptPlotted.length})`)

    // D1: the whole-country opening view must not be blown out by a handful of corrupt
    // coordinates landing in the Gulf of Guinea / North Sea — the bug this script exists to
    // catch rendered at zoom 1.77, Greenland to China, with bounds spanning -1.02 to 78.26 of
    // latitude instead of Norway's real ~39 to ~78 (the exact seven-row fix leaves 39.32 as the
    // real, legitimate low-latitude outlier — see hasKnownLocation's own doc comment). Not
    // pinned to an exact zoom/bounds figure (viewport size and padding could reasonably change
    // that), but a corrupt-bounds regression would fail these by a wide margin, not a rounding one.
    const initialView = await page.evaluate(() => {
      const bounds = window.__takeoffsMap!.getBounds()
      return { south: bounds.getSouth(), zoom: window.__takeoffsMap!.getZoom() }
    })
    report(
      initialView.south > 30,
      `the opening view's southern edge stays well clear of the Gulf of Guinea / Null Island (south edge is ${initialView.south.toFixed(2)}°, expected > 30°)`,
    )
    // Threshold at 2, not tighter: the fixture still carries longitude corruption D1 didn't
    // scope in (e.g. a takeoff with a real-looking but wrong lon=71.24, roughly Novaya Zemlya),
    // which legitimately widens the fitted view beyond what a clean Norway-only bbox would need
    // — so 2 is chosen to clearly separate the reported 1.77 world-scale bug from a real fix,
    // not to assert a precise "correct" zoom this script hasn't independently derived.
    report(
      initialView.zoom > 2,
      `the opening view is a real country-scale zoom, not the ~1.77 world-scale zoom the corrupt-bounds bug produced (got zoom ${initialView.zoom.toFixed(2)})`,
    )

    // The excluded count is not just computed — it must be VISIBLE, per #12/#10's shared rule
    // that excluding is fine, doing it silently is not. Checked against mapData's own numbers,
    // not a second absolute pin: this assertion's job is "the legend isn't lying about internal
    // state," which the band checks above already established is itself in a sane range — a
    // legend rendering NEITHER pattern at all (an empty string search below) still fails, which
    // is what actually enforces "not silent."
    const legendText = await page.evaluate(() => document.body.textContent ?? '')
    report(
      legendText.includes(`${mapData.excludedCount} excluded`) && legendText.includes(`${mapData.plottedCount} takeoffs plotted`),
      `the excluded/plotted counts are rendered as VISIBLE text on the page, matching mapData exactly, not just tracked internally (looked for "${mapData.plottedCount} takeoffs plotted" and "${mapData.excludedCount} excluded")`,
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
    const clustersAtOverview = await page.evaluate(
      (layerId) => window.__takeoffsMap!.queryRenderedFeatures(undefined, { layers: [layerId] }).length,
      CLUSTER_LAYER_ID,
    )
    const siteLayers = [UNCLUSTERED_NONE_LAYER_ID, UNCLUSTERED_ALL_LAYER_ID, UNCLUSTERED_SOME_LAYER_ID]
    const unclusteredAtOverview = await page.evaluate(
      (layerIds) => layerIds.flatMap((layerId) => window.__takeoffsMap!.queryRenderedFeatures(undefined, { layers: [layerId] })).length,
      siteLayers,
    )
    report(clustersAtOverview > 0, `clusters actually render at the whole-country overview zoom (got ${clustersAtOverview} cluster features)`)
    // Against mapData.plottedCount (the live figure already validated as in-band above), not a
    // second hardcoded pin — this assertion's job is a proportionality check (most sites
    // cluster), which the live total is the correct denominator for regardless of exactly what
    // it is.
    report(
      unclusteredAtOverview < mapData.plottedCount / 2,
      `most sites are bundled into clusters at the overview zoom, not rendered individually (${unclusteredAtOverview} unclustered features rendered, vs ${mapData.plottedCount} total plotted)`,
    )

    // --- D4: a ray must hold a roughly constant screen size across the zoom band it's
    // visible in, not grow 2x per zoom level (64x from RAY_MIN_ZOOM to 15 for a fixed-degree
    // ray — see build-takeoffs-geojson.ts's own doc comment on rayLengthDegreesAtZoom). Measured
    // as real screen pixels via map.project(), on the SAME live site, at both ends of the band.
    async function rayPixelLengthAt(zoom: number): Promise<number> {
      await page.evaluate(
        ({ coordinates, zoom }) => window.__takeoffsMap!.jumpTo({ center: coordinates as [number, number], zoom }),
        { coordinates: sampleSite.geometry.coordinates, zoom },
      )
      await page.waitForTimeout(500) // let the source re-query and the layer re-render at the new viewport
      return page.evaluate((layerId) => {
        const [ray] = window.__takeoffsMap!.queryRenderedFeatures(undefined, { layers: [layerId] })
        if (!ray || ray.geometry.type !== 'LineString') return -1
        const [start, end] = ray.geometry.coordinates as [number, number][]
        const a = window.__takeoffsMap!.project(start!)
        const b = window.__takeoffsMap!.project(end!)
        return Math.hypot(a.x - b.x, a.y - b.y)
      }, WIND_RAY_LAYER_ID)
    }

    // Zoom in on a real, live "some"-category site (picked from the actual dataset, not a
    // guessed coordinate) — past clusterMaxZoom, so it must render individually, and past
    // RAY_MIN_ZOOM, so its wind ray(s) must render too.
    const sampleSite = someFeatures[0]!
    const rayPixelLengthAtMinZoom = await rayPixelLengthAt(RAY_MIN_ZOOM)
    const rayPixelLengthAtZoom15 = await rayPixelLengthAt(15)

    report(rayPixelLengthAtMinZoom > 0, `a ray renders at RAY_MIN_ZOOM (${RAY_MIN_ZOOM}) on the live sample site (got length ${rayPixelLengthAtMinZoom.toFixed(1)}px)`)
    report(rayPixelLengthAtZoom15 > 0, `a ray renders at zoom 15 on the live sample site (got length ${rayPixelLengthAtZoom15.toFixed(1)}px)`)
    const rayGrowthRatio = rayPixelLengthAtZoom15 / rayPixelLengthAtMinZoom
    report(
      rayGrowthRatio > 0.4 && rayGrowthRatio < 2.5,
      `ray screen length stays roughly constant from zoom ${RAY_MIN_ZOOM} to 15, not a ~64x fixed-degree blowout (${rayPixelLengthAtMinZoom.toFixed(1)}px -> ${rayPixelLengthAtZoom15.toFixed(1)}px, ratio ${rayGrowthRatio.toFixed(2)})`,
    )

    const unclusteredAtSite = await page.evaluate(
      (layerIds) => layerIds.flatMap((layerId) => window.__takeoffsMap!.queryRenderedFeatures(undefined, { layers: [layerId] })).length,
      siteLayers,
    )
    const clustersAtSite = await page.evaluate(
      (layerId) => window.__takeoffsMap!.queryRenderedFeatures(undefined, { layers: [layerId] }).length,
      CLUSTER_LAYER_ID,
    )
    const raysAtSite = await page.evaluate(
      (layerId) => window.__takeoffsMap!.queryRenderedFeatures(undefined, { layers: [layerId] }).length,
      WIND_RAY_LAYER_ID,
    )

    report(unclusteredAtSite > 0, `zoomed in on a real site, individual site markers now render (got ${unclusteredAtSite})`)
    report(clustersAtSite === 0, `zoomed past clusterMaxZoom, nothing renders on the cluster layer any more (got ${clustersAtSite})`)
    report(raysAtSite > 0, `zoomed past the wind-ray minzoom on a real directional site, at least one ray actually renders (got ${raysAtSite})`)
  }
}

report(badResponses.length === 0, `no unexpected 4xx/5xx responses (saw: ${badResponses.length ? badResponses.join('; ') : 'none'})`)
report(pageErrors.length === 0, `no uncaught page errors (saw: ${pageErrors.length ? pageErrors.join('; ') : 'none'})`)
report(consoleErrors.length === 0, `no console errors, including MapLibre's own 'error' events (saw: ${consoleErrors.length ? consoleErrors.join('; ') : 'none'})`)

await browser.close()

finish('sites map browser assertion')
