// Same 'use client' rationale as watermark-store/storage.ts: this module reads/writes
// window.localStorage, so it must never run on the server.
'use client'

import {
  parseStoredSeenTrips,
  removeSeenTripIds,
  replaceSeenTripIds,
  serializeSeenTrips,
  STORED_RAW_MAX_LENGTH,
  type TripId,
} from './seen-trip-ids'
import { createCachedStore } from '@/lib/local-store/create-cached-store'
import type { PilotId } from '@/lib/flightlog/types'

type SeenTrips = ReadonlyMap<PilotId, ReadonlySet<TripId>>

// Nothing here is read reactively (no useSyncExternalStore, no subscribe/notify) — see
// getSeenTripIds's own doc comment for why — which is what lets this store and watermark-store
// share createCachedStore. The whole difference between them is this config object.
//
// On the length guard: replaceSeenTripIds bounds each PILOT's set to RECENT_FLIGHTS_PER_PILOT
// (30) ids, but MAX_PILOTS_PER_FEED (20) bounds only how many pilots ONE LOAD fetches, not how
// many accumulate an entry over time. An entry is written for any pilot who ever renders an
// untracked or window-capped flight, and removed only by an explicit unfollow. That is why
// pruneSeenTripIdsToFollowedPilots exists below rather than the guard being treated as
// unreachable.
const store = createCachedStore<SeenTrips>({
  storageKey: 'flight-log:seen-untracked-trips',
  empty: new Map(),
  parse: (raw) => {
    const result = parseStoredSeenTrips(raw)
    return result.ok ? { ok: true, value: result.seenTripIdsByPilot } : { ok: false }
  },
  serialize: serializeSeenTrips,
  equal: seenTripsEqual,
  maxRawLength: STORED_RAW_MAX_LENGTH,
  describeOversized: (seenTrips, limit) =>
    `seen-trip-store: ${seenTrips.size} pilots' seen-trip sets serialize past the ${limit}-char storage limit; not persisting.`,
})

function tripIdSetsEqual(a: ReadonlySet<TripId>, b: ReadonlySet<TripId>): boolean {
  if (a.size !== b.size) return false
  for (const tripId of a) if (!b.has(tripId)) return false
  return true
}

function seenTripsEqual(a: SeenTrips, b: SeenTrips): boolean {
  if (a.size !== b.size) return false
  for (const [pilotId, tripIds] of a) {
    const otherTripIds = b.get(pilotId)
    if (otherTripIds === undefined || !tripIdSetsEqual(tripIds, otherTripIds)) return false
  }
  return true
}

// Plain read, not a hook — same rationale as watermark-store's getWatermark: the feed reads
// each pilot's remembered set once per pilot the instant that pilot's own fetch settles (see
// use-flight-feed.ts), specifically so it can be captured BEFORE recordSeenTripIds (below)
// replaces it for the same load. `null` means this pilot has no entry recorded at all — either
// truly never seen before, or every previously-remembered id has since aged out of scope (see
// replaceSeenTripIds) — both read the same way: every flight with no resolved ts classifies as
// new (see feed.ts's classifyUntrackedNewness).
export function getSeenTripIds(pilotId: PilotId): ReadonlySet<TripId> | null {
  return store.current().get(pilotId) ?? null
}

// The only write path. See replaceSeenTripIds's own doc comment for the replace-vs-union rule
// this applies. A single object argument, not two positional same-typed Sets: `fetchedTripIds`
// and `renderedTripIds` are both `ReadonlySet<TripId>`, so two adjacent positional parameters
// of the same type would let a caller transpose them with no type error to catch it — naming
// them instead makes that swap a property-name typo, not a silent argument-order bug.
// `fetchedTripIds` is this pilot's own fetched scope for the load; `renderedTripIds` is the
// subset of those that actually made it into the merged, truncated feed (see feed.ts's
// fetchedTripIdsByPilot / shownTripIdsByPilot). Callers only invoke this for pilots that
// rendered at least one entry this load (see use-flight-feed.ts's rememberWhatWasShown) — a
// pilot contributing zero rendered entries is never called here at all, so their stored set is
// left completely untouched, the same guarantee watermark-store gives a pilot with zero shown
// tracked entries.
export function recordSeenTripIds(
  pilotId: PilotId,
  scope: { readonly fetchedTripIds: ReadonlySet<TripId>; readonly renderedTripIds: ReadonlySet<TripId> },
): void {
  store.commit(
    replaceSeenTripIds(store.current(), pilotId, scope.fetchedTripIds, scope.renderedTripIds),
  )
}

// The explicit, deliberate call unfollowing a pilot must make (see
// follow-store/use-follow-store.ts's useFollowPilot) — same rationale as watermark-store's
// clearWatermark: without it, refollowing that pilot later would compare their whole
// subsequent history against a stale remembered set from before the unfollow, instead of
// showing every flight as new again too.
export function clearSeenTripIds(pilotId: PilotId): void {
  store.commit(removeSeenTripIds(store.current(), pilotId))
}

// The other route a pilot's entry can leave this map besides an explicit unfollow: this store
// (unlike watermark-store, out of scope for that fix round — see this function's own call site
// in src/features/browse-flight-feed/index.tsx) accumulates one entry per pilot who has EVER
// rendered an untracked or window-capped flight while followed, and MAX_PILOTS_PER_FEED only
// bounds how many followed pilots ONE LOAD fetches — not how many pilots this map ever holds.
// A pilot who stays followed but falls out of selectFeedPilotIds's lowest-MAX_PILOTS_PER_FEED
// selection would otherwise keep a stale, never-refreshed entry forever. Pruning to the CURRENT
// full follow set (not a truncated load subset) removes exactly those pilots and no others — a
// still-selected pilot's entry is untouched, matching clearSeenTripIds's own "only the pilot
// actually being let go" guarantee.
export function pruneSeenTripIdsToFollowedPilots(followedIds: ReadonlySet<PilotId>): void {
  const current = store.current()
  store.commit(new Map([...current].filter(([pilotId]) => followedIds.has(pilotId))))
}
