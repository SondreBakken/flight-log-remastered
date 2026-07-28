import { existsSync, readFileSync } from 'node:fs'
import { CURATED_CLUB_COUNTRIES, CURATED_CLUB_COUNTRY_IDS } from '../src/lib/flightlog/curated-countries'
import {
  assertExactRouteSet,
  createChecker,
  readPrerenderManifest,
  requireFreshPrerenderManifest,
  routesForSrcRoute,
} from './lib/prerender-manifest-check'

// #40's central claim, mirroring check-takeoffs-prerender.mts's for its sibling route: that
// /countries/[countryId] (the clubs page) is prerendered for the curated set at BUILD time,
// not merely that generateStaticParams + 'use cache' look like they should do that. This
// script pins the claim against Next's own build output rather than trusting the source — see
// scripts/lib/prerender-manifest-check.mts for why an absent-or-stale `.next` FAILs loudly
// here rather than silently skipping, and for the freshness guard itself, both shared
// verbatim with check-takeoffs-prerender.mts rather than repeated per script.
//
// Unlike the takeoffs API ROUTE (route.ts's own doc comment: an emptied
// CURATED_TAKEOFF_COUNTRY_IDS built successfully with zero instances prerendered, silently,
// contrary to what the Cache Components docs say should happen), an emptied
// CURATED_CLUB_COUNTRY_IDS here fails `next build` outright with EmptyGenerateStaticParamsError
// — confirmed against this exact route, and against the takeoffs PAGE (as opposed to its
// sibling route.ts) too, so the route.ts behaviour looks specific to Route Handlers, not a
// general Cache Components exemption. This script is therefore a second line of defence for
// the clubs route, not the only one the way check-takeoffs-prerender.mts's own doc comment
// argues for its route.
const { assert, fail, summarize } = createChecker('check:clubs-prerender')
requireFreshPrerenderManifest(fail)

const SRC_ROUTE = '/countries/[countryId]'

const manifest = readPrerenderManifest()
const clubRouteKeys = routesForSrcRoute(manifest, SRC_ROUTE)
console.log(`prerender-manifest.json: routes under ${SRC_ROUTE} = ${clubRouteKeys.join(', ') || '(none)'}`)

for (const { countryId, expectedCountryName, expectedRowCount, expectedHtmlBytes } of CURATED_CLUB_COUNTRIES) {
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
  const htmlExists = assert(existsSync(htmlPath), `${htmlPath}: exists on disk (the actual static artifact a request is served from)`)
  const metaExists = assert(existsSync(metaPath), `${metaPath}: exists on disk (carries the 'postponed' key that distinguishes a resolved page from a deferred shell)`)
  const rscExists = assert(existsSync(rscPath), `${rscPath}: exists on disk (the RSC payload a client navigation is served from)`)
  if (!htmlExists || !metaExists || !rscExists) continue

  // A `postponed` key means Next captured this artifact as a PPR shell with an unresolved
  // hole (exactly what /countries/[countryId] produces for EVERY id today, curated or not,
  // before this page has any generateStaticParams — see the page's own pre-#40 behaviour).
  // Its absence is the actual "this id's content was resolved at build time" signal — a
  // downgrade back to that per-request hole would fail here even though renderingMode alone
  // would still read PARTIALLY_STATIC.
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { postponed?: unknown }
  assert(!('postponed' in meta), `${metaPath}: has no 'postponed' key — the club list was resolved at build time, not left as a per-request hole`)

  const html = readFileSync(htmlPath, 'utf8')
  const [minBytes, maxBytes] = expectedHtmlBytes
  assert(
    html.length >= minBytes && html.length <= maxBytes,
    `${htmlPath}: artifact size (${html.length} bytes) falls within the expected ${minBytes}-${maxBytes} byte band for country ${countryId}`,
  )

  // The static shell's own Suspense fallback (ClubsSkeleton) legitimately appears in this
  // HTML too — that is normal React SSR streaming output (the fallback paints first, then a
  // same-document script swaps in the resolved boundary), present even on a page that
  // resolved fully at build time, so its presence proves nothing either way. The actual
  // "this is the resolved club list, not just the fallback" signal is the RESOLVED content
  // sitting alongside it: the real country name (per curated entry, not hardcoded — a second
  // curated country would otherwise have the first one's name asserted against its own HTML),
  // and the exact club count rendered as plain text by CountryClubs (`{clubs.length} clubs`,
  // with React's hydration-safe text-separator comment between the number and the literal),
  // plus the actual number of rendered `<tr>` club rows — content-aware, not just "the file
  // exists", the same reasoning as check-takeoffs-prerender.mts's row-count assertion, and,
  // like that file's expectedRowCount, pinned against the live build (not the offline fixture
  // check:parsers uses), so these may need a one-line bump if flightlog.org's data drifts from
  // the fixture-time values.
  assert(html.includes(`>${expectedCountryName}</h1>`), `${htmlPath}: renders the resolved country name "${expectedCountryName}", not just the fallback shell`)
  const clubCountPattern = new RegExp(`<p class="text-sm opacity-70">${expectedRowCount}(?:<!--\\s*-->)?\\s*clubs</p>`)
  assert(clubCountPattern.test(html), `${htmlPath}: renders the expected club count "${expectedRowCount} clubs"`)
  const rowMatches = html.match(/<tr class="border-b border-black\/5 dark:border-white\/10">/g) ?? []
  assert(rowMatches.length === expectedRowCount, `${htmlPath}: renders ${expectedRowCount} club table rows (found ${rowMatches.length})`)

  // The .rsc payload is Next's "Flight" wire format, not the HTML above and not plain JSON
  // either — a handful of newline-delimited lines, most JSON but some prefixed with a numeric
  // id and colon, and JSON values themselves containing `$`-prefixed element/reference tokens
  // (`["$","h1",null,{"children":"Norway"}]`, `$L3`, ...). There is no off-the-shelf parser for
  // it here, so these are content-string assertions against that format, not JSON.parse —
  // exactly what closes the gap `existsSync` alone leaves: truncating this file to zero bytes
  // (or to any content missing the resolved club list) previously still passed, because
  // nothing but its presence on disk was ever checked. Same three signals as the HTML
  // assertions above, expressed against the serialized element tree client navigation actually
  // hydrates from, not the server-rendered markup: the resolved country name, the club count
  // text, and one `<tr>`-equivalent element per club row.
  const rsc = readFileSync(rscPath, 'utf8')
  const rscCountryNamePattern = new RegExp(`"className":"text-2xl font-semibold tracking-tight","children":${JSON.stringify(expectedCountryName)}\\}\\]`)
  assert(rscCountryNamePattern.test(rsc), `${rscPath}: serializes the resolved country name "${expectedCountryName}", not just a fallback/reference token`)
  const rscClubCountPattern = new RegExp(`"className":"text-sm opacity-70","children":\\[${expectedRowCount},"\\s*clubs"\\]`)
  assert(rscClubCountPattern.test(rsc), `${rscPath}: serializes the expected club count "${expectedRowCount} clubs"`)
  const rscRowMatches = rsc.match(/\["\$","tr","\d+",\{"className":"border-b border-black\/5 dark:border-white\/10"/g) ?? []
  assert(rscRowMatches.length === expectedRowCount, `${rscPath}: serializes ${expectedRowCount} club table rows (found ${rscRowMatches.length})`)
}

assertExactRouteSet(
  assert,
  clubRouteKeys,
  CURATED_CLUB_COUNTRY_IDS.map((countryId) => `/countries/${countryId}`),
)

summarize()
