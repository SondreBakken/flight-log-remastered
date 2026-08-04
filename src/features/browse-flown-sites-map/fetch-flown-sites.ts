import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
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
// and every curated country's tag, so a revalidateTag from either side (a fresh logbook fetch,
// or a takeoffs dataset refresh) invalidates this composed result too, not just its inputs.
export async function getFlownSites(userId: number): Promise<FlownSitesResult> {
  'use cache'
  cacheLife('hours')
  cacheTag(`pilot-${userId}`, ...CURATED_TAKEOFF_COUNTRY_IDS.map((countryId) => `country-${countryId}`))

  try {
    const [{ flights }, curatedTakeoffs] = await Promise.all([getPilotLogbook(userId), fetchCuratedTakeoffs()])
    if (flights.length === 0) return { status: 'no-flights' }

    const { sites, unmatched } = joinFlownSites(flights, curatedTakeoffs, CURATED_TAKEOFF_COUNTRY_IDS)
    return { status: 'loaded', sites, unmatched }
  } catch (error) {
    // Never lets a fetch/parse throw propagate through to a blank section — see this module's
    // own doc comment on why "could not load" must render as its own distinct state instead.
    return toErrorResult(error)
  }
}
