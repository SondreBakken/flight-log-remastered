import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CURATED_TAKEOFF_COUNTRIES, CURATED_TAKEOFF_COUNTRY_IDS } from '../src/lib/flightlog/curated-countries'
import { isTakeoffRows, type TakeoffRow } from '../src/app/api/countries/[countryId]/takeoffs/contract'

// #38's central claim is that this route is prerendered at BUILD time, not merely that
// `generateStaticParams` + `use cache` look like they should do that — see route.ts's own
// doc comment for why that distinction matters on serverless. This script is what actually
// pins the claim: it reads Next's own build output rather than trusting the source.
//
// That output has no causal link to the working tree on its own — `.next/` does not record a
// source hash, and nothing compares it to the files that produced it. Demonstrated: editing
// route.ts to add a line that doesn't even compile under Cache Components still leaves a
// perfectly readable, all-green prerender-manifest.json on disk from whatever build ran
// before the edit. `.next` absent (a clean checkout — nothing has ever built) and `.next`
// present but STALE (source edited since the last successful build, or the last build
// failed and deleted prerender-manifest.json — see next below) are made indistinguishable
// on purpose here: both FAIL loudly rather than silently pass or silently skip. Unlike
// check:parsers' fixtures/ (which requires a manual scrape this repo cannot automate),
// producing `.next` is a one-command `pnpm run build` with no manual step, so there is no
// legitimate reason for this check to pass — or even run — without one.
let failures = 0
function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}
function fail(message: string): never {
  console.error(`FAIL - check:takeoffs-prerender: ${message}`)
  process.exit(1)
}

const PRERENDER_MANIFEST_PATH = '.next/prerender-manifest.json'
if (!existsSync(PRERENDER_MANIFEST_PATH)) {
  fail(
    `${PRERENDER_MANIFEST_PATH} not found. This is gitignored Next.js build output; it does not exist ` +
      'without a local `pnpm run build`. Run `pnpm run build`, then re-run this check — it does not ' +
      'skip, because unlike fixtures/ a build is fully automatable and there is nothing legitimate to ' +
      'defer to a human here. (A build that FAILED also deletes this file, so this same message covers ' +
      'that case — re-run `pnpm run build` and read its own output.)',
  )
}

// Every file that can change what next build produces for this route — walked wholesale
// rather than hand-picked (route.ts, contract.ts, curated-countries.ts, takeoffs.ts,
// parse-takeoffs.ts, http.ts, next.config.ts, ...) because an incomplete hand-picked list is
// exactly how a real dependency (say a shared cache helper) could silently fall outside it.
// Conservative on purpose: an unrelated source edit forces a re-run of `pnpm run build` this
// check didn't strictly need, but that costs a rebuild, not a false "ok" on stale output.
function newestSourceMtimeMs(): number {
  const roots = ['src', 'next.config.ts', 'tsconfig.json', 'package.json']
  let newest = 0
  for (const root of roots) {
    if (!existsSync(root)) continue
    const stat = statSync(root)
    if (stat.isFile()) {
      newest = Math.max(newest, stat.mtimeMs)
      continue
    }
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      newest = Math.max(newest, statSync(join(entry.parentPath ?? root, entry.name)).mtimeMs)
    }
  }
  return newest
}

const manifestMtimeMs = statSync(PRERENDER_MANIFEST_PATH).mtimeMs
const sourceMtimeMs = newestSourceMtimeMs()
if (sourceMtimeMs > manifestMtimeMs) {
  fail(
    `source under src/ (or next.config.ts/tsconfig.json/package.json) was modified after ` +
      `${PRERENDER_MANIFEST_PATH} was written — the build on disk predates the working tree and proves ` +
      'nothing about it. This is exactly the gap that let `force-dynamic` added to the route (a line ' +
      "that doesn't even compile under Cache Components) still read as a green, STATIC prerender: the " +
      'manifest from the PREVIOUS build was still sitting on disk, untouched. Run `pnpm run build` again, ' +
      'then re-run this check.',
  )
}

const SRC_ROUTE = '/api/countries/[countryId]/takeoffs'

type PrerenderManifest = {
  routes: Record<string, { renderingMode?: string; srcRoute?: string }>
}

const manifest = JSON.parse(readFileSync(PRERENDER_MANIFEST_PATH, 'utf8')) as PrerenderManifest

// Every route this app prerendered under the takeoffs API's own srcRoute — computed from
// the manifest itself, not from CURATED_TAKEOFF_COUNTRY_IDS, so the "nothing beyond the
// curated set" assertion below can't pass by construction.
const takeoffRouteKeys = Object.keys(manifest.routes).filter((key) => manifest.routes[key].srcRoute === SRC_ROUTE)
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

// Confirms the curated set really is curated — nothing beyond it got prerendered as a side
// effect of, say, generateStaticParams silently returning more than intended.
const expectedRouteKeys = CURATED_TAKEOFF_COUNTRY_IDS.map((countryId) => `/api/countries/${countryId}/takeoffs`).sort()
assert(
  JSON.stringify([...takeoffRouteKeys].sort()) === JSON.stringify(expectedRouteKeys),
  `prerender-manifest.json: prerenders exactly the curated set (${expectedRouteKeys.join(', ')}), nothing more`,
)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
