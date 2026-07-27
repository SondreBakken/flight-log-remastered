import { CURATED_TAKEOFF_COUNTRY_IDS } from '@/lib/flightlog/curated-countries'
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
  const id = Number(countryId)
  if (!CURATED_TAKEOFF_COUNTRY_IDS.includes(id)) {
    return Response.json({ error: `country ${countryId} is not in the curated takeoffs set` }, { status: 404 })
  }

  const takeoffs = await getTakeoffs(id)
  const rows: TakeoffRow[] = takeoffs.map(encodeTakeoffRow)
  return Response.json(rows)
}
