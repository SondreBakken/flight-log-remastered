// #76's join: given a pilot's logbook and the curated takeoff dataset(s) it may join against,
// which distinct sites did this pilot actually launch from — and which takeoffs could this
// dataset not locate. Pure and side-effect-free (no fetch, no cache directive) so it is unit-
// testable against synthetic Flight/Takeoff values without a network or a real HTML fixture;
// fetch-flown-sites.ts is the thin infra layer that composes this with the two live data
// sources. See parse-flights.ts's readTakeoffRef for how a Flight's `takeoffRef` is produced.
import { hasKnownLocation } from '@/lib/flightlog/has-known-location'
import type { Flight, Takeoff, TakeoffRef } from '@/lib/flightlog/types'

export type FlownSite = {
  takeoffId: number
  countryId: number
  name: string
  lat: number
  lon: number
  flightCount: number
}

// Four distinct reasons a takeoff could not be PLOTTED, per #76's acceptance criteria (a
// dropped marker is never acceptable — every one must resolve to one of these, visible in the
// UI, not silently absorbed into the matched count or discarded):
//   - 'unlinked': the logbook row's takeoff cell had no parseable link at all (no `a=42` link,
//     or a malformed href — see readTakeoffRef). This app cannot even name a country to blame.
//   - 'uncurated-country': the link parsed fine, but its countryId isn't one this app curates a
//     takeoff dataset for (see CURATED_TAKEOFF_COUNTRY_IDS) — by design, this app never fetches
//     an uncurated country's dataset per pilot request, so these can never be resolved today.
//   - 'not-found': the link named a curated country, but its takeoffId isn't in that country's
//     own dataset — no case sampled while approving #76's join key has produced this (5/5
//     verified), so it exists defensively rather than from an observed cause.
//   - 'no-known-location': the takeoff WAS found by id in the curated dataset — this is a real
//     match, not a join miss — but its own lat/lon are the coordinate-placeholder/corruption
//     shapes hasKnownLocation guards against (measured against pilot 4549 x takeoffs-160: one
//     matched takeoff carries exactly this). Plotting it anyway would draw a marker in the Gulf
//     of Guinea and blow out the map's fitted bounds, the same failure components/takeoffs-map
//     already excludes for (see its own hasKnownLocation usage) — folded into `unmatched` here
//     rather than a fifth top-level state, since from a "why isn't this a marker" reading it's
//     the same kind of fact as the other three.
export type UnmatchedReason = 'unlinked' | 'uncurated-country' | 'not-found' | 'no-known-location'

export type UnmatchedSite = {
  name: string
  reason: UnmatchedReason
  flightCount: number
}

export type FlownSitesJoinResult = {
  sites: FlownSite[]
  unmatched: UnmatchedSite[]
}

const UNKNOWN_TAKEOFF = 'Unknown takeoff'

// countryId alone is not a stable takeoffId namespace to assume (flightlog.org's own start_id
// values are not confirmed globally unique across every country), so every lookup and grouping
// key below pairs the two rather than trusting takeoffId alone.
function takeoffKey(countryId: number, takeoffId: number): string {
  return `${countryId}:${takeoffId}`
}

function indexByTakeoffKey(takeoffs: Takeoff[]): Map<string, Takeoff> {
  const index = new Map<string, Takeoff>()
  for (const takeoff of takeoffs) index.set(takeoffKey(takeoff.countryId, takeoff.takeoffId), takeoff)
  return index
}

type FlightOutcome = { status: 'matched'; takeoff: Takeoff } | { status: 'unmatched'; reason: UnmatchedReason }

function classifyRef(
  ref: TakeoffRef | null,
  curatedCountryIds: readonly number[],
  takeoffsByKey: Map<string, Takeoff>,
): FlightOutcome {
  if (ref === null) return { status: 'unmatched', reason: 'unlinked' }
  if (!curatedCountryIds.includes(ref.countryId)) return { status: 'unmatched', reason: 'uncurated-country' }
  const takeoff = takeoffsByKey.get(takeoffKey(ref.countryId, ref.takeoffId))
  if (!takeoff) return { status: 'unmatched', reason: 'not-found' }
  if (!hasKnownLocation(takeoff)) return { status: 'unmatched', reason: 'no-known-location' }
  return { status: 'matched', takeoff }
}

// Grouping key for an unmatched flight: by its own ref when it has one (two flights citing the
// same uncurated or not-found takeoff collapse into one unmatched entry, not one per flight),
// falling back to the display name only for the 'unlinked' case, which has no ref to group by.
function unmatchedGroupKey(flight: Flight): string {
  return flight.takeoffRef ? `ref:${takeoffKey(flight.takeoffRef.countryId, flight.takeoffRef.takeoffId)}` : `name:${flight.takeoff ?? UNKNOWN_TAKEOFF}`
}

function addMatchedFlight(sites: Map<string, FlownSite>, takeoff: Takeoff, flightCount: number): void {
  const key = takeoffKey(takeoff.countryId, takeoff.takeoffId)
  const existing = sites.get(key)
  sites.set(key, {
    takeoffId: takeoff.takeoffId,
    countryId: takeoff.countryId,
    name: takeoff.name,
    lat: takeoff.lat,
    lon: takeoff.lon,
    flightCount: (existing?.flightCount ?? 0) + flightCount,
  })
}

function addUnmatchedFlight(unmatched: Map<string, UnmatchedSite>, flight: Flight, reason: UnmatchedReason): void {
  const key = unmatchedGroupKey(flight)
  const existing = unmatched.get(key)
  unmatched.set(key, {
    name: flight.takeoff ?? UNKNOWN_TAKEOFF,
    reason,
    flightCount: (existing?.flightCount ?? 0) + flight.flightCount,
  })
}

// `curatedTakeoffs` is expected to already be restricted to `curatedCountryIds`' own datasets
// (fetch-flown-sites.ts's job, not this function's) — passed separately rather than derived
// here so this stays pure and the "which countries does this app fetch a dataset for" decision
// lives in exactly one place (curated-countries.ts), not duplicated as a second filter.
export function joinFlownSites(
  flights: Flight[],
  curatedTakeoffs: Takeoff[],
  curatedCountryIds: readonly number[],
): FlownSitesJoinResult {
  const takeoffsByKey = indexByTakeoffKey(curatedTakeoffs)
  const sites = new Map<string, FlownSite>()
  const unmatched = new Map<string, UnmatchedSite>()

  for (const flight of flights) {
    const outcome = classifyRef(flight.takeoffRef, curatedCountryIds, takeoffsByKey)
    if (outcome.status === 'matched') addMatchedFlight(sites, outcome.takeoff, flight.flightCount)
    else addUnmatchedFlight(unmatched, flight, outcome.reason)
  }

  return { sites: [...sites.values()], unmatched: [...unmatched.values()] }
}
