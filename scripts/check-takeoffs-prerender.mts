import { existsSync, readFileSync, statSync } from 'node:fs'
import { CURATED_TAKEOFF_COUNTRY_IDS } from '../src/lib/flightlog/curated-countries'
import { TAKEOFF_ROW_COUNT_EXPECTATIONS } from './lib/curated-country-expectations'
import { isTakeoffRows, type TakeoffRow } from '../src/app/api/countries/[countryId]/takeoffs/contract'
import { formatRange, inRange } from './lib/range'
import {
  assertExactRouteSet,
  createChecker,
  readPrerenderManifest,
  requireFreshPrerenderManifest,
  routesForSrcRoute,
} from './lib/prerender-manifest-check'

// #38's central claim is that this route is prerendered at BUILD time, not merely that
// `generateStaticParams` + `use cache` look like they should do that — see route.ts's own
// doc comment for why that distinction matters on serverless. This script is what actually
// pins the claim: it reads Next's own build output rather than trusting the source. See
// scripts/lib/prerender-manifest-check.ts for why an absent-or-stale `.next` FAILs loudly
// here rather than silently skipping — that reasoning, and the freshness guard itself, are
// shared with check-clubs-prerender.mts verbatim, not repeated per script.
const { assert, fail, summarize } = createChecker('check:takeoffs-prerender')
requireFreshPrerenderManifest(fail)

const SRC_ROUTE = '/api/countries/[countryId]/takeoffs'

const manifest = readPrerenderManifest()
const takeoffRouteKeys = routesForSrcRoute(manifest, SRC_ROUTE)
console.log(`prerender-manifest.json: routes under ${SRC_ROUTE} = ${takeoffRouteKeys.join(', ') || '(none)'}`)

for (const { countryId, rowCountRange, bytesPerRowRange } of TAKEOFF_ROW_COUNT_EXPECTATIONS) {
  const routeKey = `/api/countries/${countryId}/takeoffs`
  const entry = manifest.routes[routeKey]

  assert(entry !== undefined, `prerender-manifest.json: has an entry for ${routeKey}`)
  assert(entry?.renderingMode === 'STATIC', `prerender-manifest.json: ${routeKey} is renderingMode STATIC (got ${entry?.renderingMode ?? 'MISSING'})`)
  assert(entry?.srcRoute === SRC_ROUTE, `prerender-manifest.json: ${routeKey} traces back to ${SRC_ROUTE} (got ${entry?.srcRoute ?? 'MISSING'})`)

  // The manifest entry alone doesn't prove a response body actually got written to disk at
  // build time — this is the artifact a request for this path is served from without ever
  // running the route handler again. See getStaticFilePath-shaped output under
  // .next/server/app: a per-country `<id>/takeoffs.body` + `.meta` pair, sibling to the
  // dynamic `[countryId]/takeoffs/route.js` (the request-time fallback code, unused for
  // curated ids once this file exists).
  const bodyPath = `.next/server/app/api/countries/${countryId}/takeoffs.body`
  assert(existsSync(bodyPath), `${bodyPath}: exists on disk (the actual static artifact a request is served from)`)
  if (!existsSync(bodyPath)) continue

  const bytes = statSync(bodyPath).size
  const parsed: unknown = JSON.parse(readFileSync(bodyPath, 'utf8'))
  console.log(`${bodyPath}: ${bytes} bytes on disk, ${Array.isArray(parsed) ? parsed.length : 'NOT AN ARRAY'} rows`)

  // Content-aware, not just "parses as an array": `[1,2,3]` (7 bytes) parses as a non-empty
  // array and previously passed this check outright. isTakeoffRows applies the same
  // wire-boundary shape guard the browser-side consumer applies to this exact payload — if
  // the artifact wouldn't survive that guard client-side, it shouldn't survive this one
  // either.
  const hasValidShape = isTakeoffRows(parsed)
  assert(hasValidShape, `${bodyPath}: every row passes the wire-boundary shape check (isTakeoffRows)`)
  if (!hasValidShape) continue
  const rows = parsed as TakeoffRow[]

  // Catches another curated country's rows served under this one's path — a row's own
  // countryId (index 5, TakeoffRow's field order) disagreeing with the path it was served
  // from is a cache-key/artifact mixup, not a rendering-mode question, and nothing above
  // would notice it.
  const wrongCountryRows = rows.filter((row) => row[5] !== countryId)
  assert(wrongCountryRows.length === 0, `${bodyPath}: every row's countryId field matches ${countryId} (found ${wrongCountryRows.length} row(s) that don't)`)

  // A floor and a ceiling, not `=== expectedRowCount` (#55): `rows` comes from a REAL BUILD's
  // LIVE fetch of flightlog.org, which grows over time as pilots log new takeoffs — an exact
  // pin here goes stale the moment someone logs one, on a schedule this repo doesn't control.
  // curated-country-expectations.ts's own doc comment on rowCountRange has the full
  // frozen-vs-live reasoning and why the floor, specifically, is what catches a parser or
  // route silently dropping most rows. Not `> 0` either: that would also accept the "some
  // unrelated multiple" and "most rows silently dropped" failures this band exists to catch.
  assert(
    inRange(rows.length, rowCountRange),
    `${bodyPath}: row count falls within the expected ${formatRange(rowCountRange)} band for country ${countryId} (got ${rows.length})`,
  )

  // Runs against the real build artifact, unlike check:parsers' identical band, which only
  // runs when fixtures/ (gitignored) is present locally and is therefore invisible to CI on a
  // clean checkout. Bytes PER ROW, not total artifact bytes (#55) — see
  // curated-country-expectations.ts's own doc comment on bytesPerRowRange for why: a total
  // drifts with the row count above it depends on, a per-row average doesn't. `rows.length ===
  // 0` (an emptied artifact) divides out to `Infinity`, which fails this band on its own
  // without a special case — the row-count floor above already fails it too, so the two bands
  // corroborate rather than one silently standing in for the other.
  const bytesPerRow = rows.length > 0 ? bytes / rows.length : Infinity
  assert(
    inRange(bytesPerRow, bytesPerRowRange),
    `${bodyPath}: serialised bytes per row (${bytesPerRow.toFixed(2)}) falls within the expected ${formatRange(bytesPerRowRange)} band for country ${countryId} (${bytes} bytes / ${rows.length} rows)`,
  )
}

assertExactRouteSet(
  assert,
  takeoffRouteKeys,
  CURATED_TAKEOFF_COUNTRY_IDS.map((countryId) => `/api/countries/${countryId}/takeoffs`),
)

summarize()
