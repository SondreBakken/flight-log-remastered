import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CURATED_CLUB_COUNTRIES, CURATED_CLUB_COUNTRY_IDS } from '../src/lib/flightlog/curated-countries'

// #40's central claim, mirroring check-takeoffs-prerender.mts's for its sibling route: that
// /countries/[countryId] (the clubs page) is prerendered for the curated set at BUILD time,
// not merely that generateStaticParams + 'use cache' look like they should do that. This
// script pins the claim against Next's own build output rather than trusting the source —
// see that file's own doc comment for why an empty .next (absent OR stale) fails loudly
// rather than silently skipping, and why the freshness guard below is a conservative,
// wholesale walk of everything that can change what `next build` produces.
let failures = 0
function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}
function fail(message: string): never {
  console.error(`FAIL - check:clubs-prerender: ${message}`)
  process.exit(1)
}

const PRERENDER_MANIFEST_PATH = '.next/prerender-manifest.json'
if (!existsSync(PRERENDER_MANIFEST_PATH)) {
  fail(
    `${PRERENDER_MANIFEST_PATH} not found. This is gitignored Next.js build output; it does not exist ` +
      'without a local `pnpm run build`. Run `pnpm run build`, then re-run this check.',
  )
}

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
      'nothing about it. Run `pnpm run build` again, then re-run this check.',
  )
}

const SRC_ROUTE = '/countries/[countryId]'

type PrerenderManifest = {
  routes: Record<string, { renderingMode?: string; srcRoute?: string }>
}

const manifest = JSON.parse(readFileSync(PRERENDER_MANIFEST_PATH, 'utf8')) as PrerenderManifest

// Every route this app prerendered under the clubs page's own srcRoute — computed from the
// manifest itself, not from CURATED_CLUB_COUNTRY_IDS, so "nothing beyond the curated set"
// below can't pass by construction.
const clubRouteKeys = Object.keys(manifest.routes).filter((key) => manifest.routes[key].srcRoute === SRC_ROUTE)
console.log(`prerender-manifest.json: routes under ${SRC_ROUTE} = ${clubRouteKeys.join(', ') || '(none)'}`)

for (const { countryId, expectedRowCount } of CURATED_CLUB_COUNTRIES) {
  const routeKey = `/countries/${countryId}`
  const entry = manifest.routes[routeKey]

  // Unlike the takeoffs API route, this page's renderingMode reads PARTIALLY_STATIC even
  // when fully resolved at build time — Cache Components/PPR labels every page that way once
  // PPR is enabled app-wide, regardless of whether that particular page still has a runtime
  // hole. The signal that actually distinguishes "prerendered" from "the same PPR fallback
  // shell every other uncurated country id gets" is a CONCRETE entry here (this page has no
  // generateStaticParams-less id under `routes` at all today — only `dynamicRoutes` carries
  // the `[countryId]` fallback pattern) whose own srcRoute traces back to this page, checked
  // below alongside the on-disk artifact.
  assert(entry !== undefined, `prerender-manifest.json: has a concrete entry for ${routeKey} (not just the dynamic-route fallback)`)
  assert(entry?.srcRoute === SRC_ROUTE, `prerender-manifest.json: ${routeKey} traces back to ${SRC_ROUTE} (got ${entry?.srcRoute ?? 'MISSING'})`)

  const htmlPath = `.next/server/app/countries/${countryId}.html`
  const metaPath = `.next/server/app/countries/${countryId}.meta`
  const rscPath = `.next/server/app/countries/${countryId}.rsc`
  assert(existsSync(htmlPath), `${htmlPath}: exists on disk (the actual static artifact a request is served from)`)
  assert(existsSync(rscPath), `${rscPath}: exists on disk (the RSC payload a client navigation is served from)`)
  if (!existsSync(htmlPath) || !existsSync(metaPath) || !existsSync(rscPath)) continue

  // A `postponed` key means Next captured this artifact as a PPR shell with an unresolved
  // hole (exactly what /countries/[countryId] produces for EVERY id today, curated or not,
  // before this page has any generateStaticParams — see the page's own pre-#40 behaviour).
  // Its absence is the actual "this id's content was resolved at build time" signal — a
  // downgrade back to that per-request hole would fail here even though renderingMode alone
  // would still read PARTIALLY_STATIC.
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { postponed?: unknown }
  assert(!('postponed' in meta), `${metaPath}: has no 'postponed' key — the club list was resolved at build time, not left as a per-request hole`)

  const html = readFileSync(htmlPath, 'utf8')
  console.log(`${htmlPath}: ${html.length} bytes on disk`)

  // The static shell's own Suspense fallback (ClubsSkeleton) legitimately appears in this
  // HTML too — that is normal React SSR streaming output (the fallback paints first, then a
  // same-document script swaps in the resolved boundary), present even on a page that
  // resolved fully at build time, so its presence proves nothing either way. The actual
  // "this is the resolved club list, not just the fallback" signal is the RESOLVED content
  // sitting alongside it: the real country name, and the exact club count rendered as plain
  // text by CountryClubs (`{clubs.length} clubs`, with React's hydration-safe text-separator
  // comment between the number and the literal). Content-aware, not just "the file exists" —
  // the same reasoning as check-takeoffs-prerender.mts's row-count assertion, and, like that
  // file's expectedRowCount, pinned against the live build (not the offline fixture
  // check:parsers uses), so this may need a one-line bump if flightlog.org's Norway club
  // count drifts from the fixture-time value of 91.
  assert(html.includes('>Norway</h1>'), `${htmlPath}: renders the resolved country name "Norway", not just the fallback shell`)
  const clubCountPattern = new RegExp(`<p class="text-sm opacity-70">${expectedRowCount}(?:<!--\\s*-->)?\\s*clubs</p>`)
  assert(clubCountPattern.test(html), `${htmlPath}: renders the expected club count "${expectedRowCount} clubs"`)
}

// Confirms the curated set really is curated — nothing beyond it got prerendered as a side
// effect of, say, generateStaticParams silently returning more than intended.
const expectedRouteKeys = CURATED_CLUB_COUNTRY_IDS.map((countryId) => `/countries/${countryId}`).sort()
assert(
  JSON.stringify([...clubRouteKeys].sort()) === JSON.stringify(expectedRouteKeys),
  `prerender-manifest.json: prerenders exactly the curated set (${expectedRouteKeys.join(', ')}), nothing more`,
)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
