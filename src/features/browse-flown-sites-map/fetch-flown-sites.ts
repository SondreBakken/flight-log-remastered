import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { CURATED_TAKEOFF_COUNTRY_IDS } from '@/lib/flightlog/curated-countries'
import { getPilotLogbook } from '@/lib/flightlog/flights'
import { getTakeoffs } from '@/lib/flightlog/takeoffs'
import type { Takeoff } from '@/lib/flightlog/types'
import { joinFlownSites, type FlownSite, type UnmatchedSite } from './join-flown-sites'

// #76's three top-level states — kept apart the same way ScoringGeometryResult's doc comment
// argues for (see types.ts): "the logbook/dataset failed to load" (`error`), "it loaded and
// this pilot genuinely has no flights yet" (`no-flights`), and "it loaded, and here's what the
// join found, including zero matched sites" (`loaded`) are three different facts about the
// world. Collapsing an error into `loaded: { sites: [], unmatched: [] }` would render a blank
// map claiming "no sites" instead of "could not check" — exactly the confident-wrong-omission
// failure #76 exists to rule out. `loaded.unmatched` covers acceptance criterion 1 (a visible,
// counted, named omission); it is never absent from this variant, only possibly empty.
export type FlownSitesResult =
  | { status: 'error'; message: string }
  | { status: 'no-flights' }
  | { status: 'loaded'; sites: FlownSite[]; unmatched: UnmatchedSite[] }

async function fetchCuratedTakeoffs(): Promise<Takeoff[]> {
  const perCountry = await Promise.all(CURATED_TAKEOFF_COUNTRY_IDS.map((countryId) => getTakeoffs(countryId)))
  return perCountry.flat()
}

function toErrorResult(error: unknown): FlownSitesResult {
  const message = error instanceof Error ? error.message : 'flown sites could not be loaded'
  return { status: 'error', message }
}

// Composes two already-'use cache' sources (getPilotLogbook, getTakeoffs) under its own
// explicit cacheLife, per the framework's own recommendation (see cacheLife's "nested caching"
// docs: an explicit outer lifetime always wins over inner ones, so this doesn't inherit
// getTakeoffs's longer 'days' profile just because it's the last one awaited). 'hours' matches
// getPilotLogbook's own profile — the pilot's own logbook is the more volatile of the two
// composed inputs, so this result should not outlive it. Tagged with both this pilot's own tag
// and every curated country's tag — no call site in this repo invokes revalidateTag with either
// tag today, so this is not a live invalidation path yet; the tags exist so that a FUTURE
// revalidateTag(`pilot-${userId}`) or revalidateTag(`country-${countryId}`) (a fresh logbook
// fetch, or a takeoffs dataset refresh) has something to reach on this composed result too, not
// just on its inputs.
//
// Deliberately lets a fetch/parse throw PROPAGATE, unlike getFlownSites below — 'use cache'
// only ever memoizes a function that returns normally; a throw aborts the cache write instead of
// writing one. Encoding the error as a returned `{ status: 'error' }` value here, the way
// getFlownSites's own try/catch does per-request, would make that a cached, successful write —
// pinning the error for this whole cacheLife('hours') window with no revalidateTag anywhere in
// this repo to clear it early. See getFlownSites below for where the error is actually caught
// and encoded, once per request rather than once per cache entry.
async function loadFlownSites(userId: number): Promise<FlownSitesResult> {
  'use cache'
  cacheLife('hours')
  cacheTag(`pilot-${userId}`, ...CURATED_TAKEOFF_COUNTRY_IDS.map((countryId) => `country-${countryId}`))

  const [{ flights }, curatedTakeoffs] = await Promise.all([getPilotLogbook(userId), fetchCuratedTakeoffs()])
  if (flights.length === 0) return { status: 'no-flights' }

  const { sites, unmatched } = joinFlownSites(flights, curatedTakeoffs, CURATED_TAKEOFF_COUNTRY_IDS)
  return { status: 'loaded', sites, unmatched }
}

// The uncached entry point every caller actually uses. Never lets a fetch/parse throw propagate
// through to a blank section — see this module's own doc comment on why "could not load" must
// render as its own distinct state instead — but catches it HERE, outside loadFlownSites's own
// 'use cache' boundary, so a failure is reported fresh on every request instead of being written
// into the cache as a successful `{ status: 'error' }` entry (see loadFlownSites's own comment).
export async function getFlownSites(userId: number): Promise<FlownSitesResult> {
  try {
    return await loadFlownSites(userId)
  } catch (error) {
    // This catch sits directly around a 'use cache' call, so it can also intercept Next's own
    // internal control-flow errors (a prerender abort/postpone signal today; notFound()/
    // redirect() thrown from inside a future version of loadFlownSites), not just a real
    // fetch/parse failure. unstable_rethrow lets those pass through Next's own machinery
    // unchanged instead of being swallowed and misreported as this feature's "could not load"
    // state. Must run first, before toErrorResult below ever gets a chance to treat one as an
    // ordinary error.
    unstable_rethrow(error)
    return toErrorResult(error)
  }
}
