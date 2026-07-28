import { existsSync, readFileSync, statSync } from 'node:fs'
import { CURATED_TAKEOFF_COUNTRIES, CURATED_TAKEOFF_COUNTRY_IDS } from '../src/lib/flightlog/curated-countries'
import { isTakeoffRows, type TakeoffRow } from '../src/app/api/countries/[countryId]/takeoffs/contract'
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
// scripts/lib/prerender-manifest-check.mts for why an absent-or-stale `.next` FAILs loudly
// here rather than silently skipping — that reasoning, and the freshness guard itself, are
// shared with check-clubs-prerender.mts verbatim, not repeated per script.
const { assert, fail, summarize } = createChecker('check:takeoffs-prerender')
requireFreshPrerenderManifest(fail)

const SRC_ROUTE = '/api/countries/[countryId]/takeoffs'

const manifest = readPrerenderManifest()
const takeoffRouteKeys = routesForSrcRoute(manifest, SRC_ROUTE)
console.log(`prerender-manifest.json: routes under ${SRC_ROUTE} = ${takeoffRouteKeys.join(', ') || '(none)'}`)

for (const { countryId, expectedRowCount, expectedPayloadBytes } of CURATED_TAKEOFF_COUNTRIES) {
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

  // Runs against the real build artifact, unlike check:parsers' identical band, which only
  // runs when fixtures/ (gitignored) is present locally and is therefore invisible to CI on a
  // clean checkout. This is a coarse sanity band on total serialised size, not a field-shape
  // guard — see curated-countries.ts's own doc comment on expectedPayloadBytes for what it
  // does and does not catch, and why.
  const [minBytes, maxBytes] = expectedPayloadBytes
  assert(
    bytes >= minBytes && bytes <= maxBytes,
    `${bodyPath}: artifact size (${bytes} bytes) falls within the expected ${minBytes}-${maxBytes} byte band for country ${countryId}`,
  )

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

  // Exact, not `> 0`: a curated country can legitimately have zero takeoffs (check:parsers
  // pins this for Bouvet Island), so `> 0` would fail a real, correct build for such a
  // country. expectedRowCount is curated-countries.ts's own record of what this exact
  // fixture produced — see its doc comment for why an exact match, not a range, is the
  // right check here.
  assert(rows.length === expectedRowCount, `${bodyPath}: row count matches the curated expectation for country ${countryId} (expected ${expectedRowCount}, got ${rows.length})`)
}

assertExactRouteSet(
  assert,
  takeoffRouteKeys,
  CURATED_TAKEOFF_COUNTRY_IDS.map((countryId) => `/api/countries/${countryId}/takeoffs`),
)

summarize()
