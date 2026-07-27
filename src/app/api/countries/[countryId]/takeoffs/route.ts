import { CURATED_TAKEOFF_COUNTRY_IDS, parseCuratedCountryId } from '@/lib/flightlog/curated-countries'
import { getTakeoffs } from '@/lib/flightlog/takeoffs'
import { encodeTakeoffRow, type TakeoffRow } from './contract'

// #38's decision, in one line: prerender this at BUILD time for a curated set of countries,
// so the 970 KB upstream fetch (getTakeoffs, unchanged) is a build cost and the response is
// a static asset the CDN and the browser both cache — rather than a route that runs
// `getTakeoffs`'s `use cache` at request time, where the Next.js docs say entries typically
// do not persist across requests on serverless (each request can hit a different instance).
// `generateStaticParams` plus this route's own deterministic, cache-backed data access is
// what makes `next build` able to fully render the response for every id below and write it
// to disk — see scripts/check-takeoffs-prerender.mts, which asserts that against the real
// build output rather than trusting this comment.
//
// Measured, not assumed: the docs (generate-static-params.md) say Cache Components makes an
// empty return here a build ERROR. For THIS route, on Next.js 16.2.12/Turbopack, that did
// not hold — returning `[]` built successfully with zero instances prerendered, silently.
// check-takeoffs-prerender.mts is what actually catches that (asserted against a real build
// with this function mutated to `return []`), not the build step itself.
export async function generateStaticParams(): Promise<{ countryId: string }[]> {
  return CURATED_TAKEOFF_COUNTRY_IDS.map((countryId) => ({ countryId: String(countryId) }))
}

type RouteParams = { params: Promise<{ countryId: string }> }

// :countryId is unauthenticated user input straight off the URL, same as recent-flights
// route's :userId — without a cap, a long garbage segment is reflected back in the 404 body
// at whatever length the caller sent it.
const MAX_ECHOED_COUNTRY_ID_LENGTH = 32

// `dynamicParams = false` (the usual way to 404 params generateStaticParams didn't
// enumerate) is rejected outright by Cache Components — see dynamicParams.md: "not
// available when Cache Components is enabled." Without it, an uncurated id falls through to
// request-time rendering by default, which would reintroduce, for that id, exactly the "use
// cache doesn't persist on serverless" caveat this route exists to sidestep. This check is
// the replacement: a plain, deterministic membership test that completes during
// prerendering for every curated id (so it never blocks the static shell) and short-circuits
// BEFORE `getTakeoffs` for anything else, so an uncurated id never even attempts the
// uncached fetch it would need if this route trusted the framework to gate it.
export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const { countryId } = await params
  const id = parseCuratedCountryId(countryId)
  if (id === null) {
    const echoedCountryId = countryId.slice(0, MAX_ECHOED_COUNTRY_ID_LENGTH)
    return Response.json({ error: `country ${echoedCountryId} is not in the curated takeoffs set` }, { status: 404 })
  }

  try {
    const takeoffs = await getTakeoffs(id)
    const rows: TakeoffRow[] = takeoffs.map(encodeTakeoffRow)
    return Response.json(rows)
  } catch (error) {
    // Same reasoning as recent-flights/route.ts (the first route handler in the repo, and
    // the pattern every route since has copied): error.message embeds the scraped-from
    // upstream path (see http.ts: "flightlog.org returned 500 for /fl.html?..."), which must
    // never reach the client. Lower exposure than recent-flights — a build-time failure here
    // fails the deploy outright, which is already accepted — but this still runs at request
    // time whenever `use cache`'s entry has expired and needs revalidating, so it is
    // reachable, not merely theoretical.
    console.error(`takeoffs: country ${id} failed`, error)
    return Response.json({ error: `could not load takeoffs for country ${id}` }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
