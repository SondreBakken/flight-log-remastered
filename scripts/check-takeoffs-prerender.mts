import { existsSync, readFileSync, statSync } from 'node:fs'
import { CURATED_TAKEOFF_COUNTRY_IDS } from '../src/lib/flightlog/curated-countries'

// #38's central claim is that this route is prerendered at BUILD time, not merely that
// `generateStaticParams` + `use cache` look like they should do that — see route.ts's own
// doc comment for why that distinction matters on serverless. This script is what actually
// pins the claim: it reads Next's own build output rather than trusting the source.
//
// `.next/` is gitignored and only exists after `pnpm run build` — absent in a clean
// checkout, same as fixtures/ for check:parsers. Skip loudly and exit 0 rather than fail:
// this means "nothing to check here yet," not "the mechanism is broken."
const PRERENDER_MANIFEST_PATH = '.next/prerender-manifest.json'
if (!existsSync(PRERENDER_MANIFEST_PATH)) {
  console.log(
    `SKIP - check:takeoffs-prerender: ${PRERENDER_MANIFEST_PATH} not found.\n` +
      'This is gitignored Next.js build output, not present without a local `pnpm run build`. ' +
      'Run the build, then re-run this check, to actually exercise the prerendering claim.',
  )
  process.exit(0)
}

let failures = 0
function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
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

for (const countryId of CURATED_TAKEOFF_COUNTRY_IDS) {
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

  if (existsSync(bodyPath)) {
    const bytes = statSync(bodyPath).size
    const rows: unknown = JSON.parse(readFileSync(bodyPath, 'utf8'))
    console.log(`${bodyPath}: ${bytes} bytes on disk, ${Array.isArray(rows) ? rows.length : 'NOT AN ARRAY'} rows`)
    assert(Array.isArray(rows) && rows.length > 0, `${bodyPath}: parses as a non-empty JSON array of rows`)
  }
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
