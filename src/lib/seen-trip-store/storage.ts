// Same 'use client' rationale as watermark-store/storage.ts: this module reads/writes
// window.localStorage, so it must never run on the server.
'use client'

import {
  parseStoredSeenTrips,
  removeSeenTripIds,
  replaceSeenTripIds,
  serializeSeenTrips,
  STORED_RAW_MAX_LENGTH,
  type StoredSeenTripsRead,
  type TripId,
} from './seen-trip-ids'
import type { PilotId } from '@/lib/flightlog/types'

const STORAGE_KEY = 'flight-log:seen-untracked-trips'

const EMPTY_SEEN_TRIPS: ReadonlyMap<PilotId, ReadonlySet<TripId>> = new Map()

// Same rationale as watermark-store/storage.ts's own module doc comment: nothing here is read
// reactively (no useSyncExternalStore, no subscribe/notify) — see getSeenTripIds's own doc
// comment for why — so this is just two module-scope variables, not a snapshot object.
let hydrated = false
let seenTripIdsByPilot: ReadonlyMap<PilotId, ReadonlySet<TripId>> = EMPTY_SEEN_TRIPS

function readSeenTrips(): StoredSeenTripsRead {
  if (typeof window === 'undefined') return { ok: false }
  try {
    return parseStoredSeenTrips(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    // Safari private mode and disabled storage throw on access.
    return { ok: false }
  }
}

function writeSeenTrips(next: ReadonlyMap<PilotId, ReadonlySet<TripId>>): void {
  if (typeof window === 'undefined') return
  const serialized = serializeSeenTrips(next)
  // Mirrors watermark-store/storage.ts's writeWatermarks guard: a payload past the limit
  // would fail to parse on next load anyway, so skip persisting it rather than silently lose
  // the map. The in-memory value still updates for this tab; only durability across reloads
  // is given up. replaceSeenTripIds bounds each PILOT's set to RECENT_FLIGHTS_PER_PILOT (30)
  // ids, but MAX_PILOTS_PER_FEED (20) bounds only how many pilots ONE LOAD fetches — not how
  // many pilots accumulate an entry in this map over time. An entry is written for any pilot
  // that ever renders an untracked or window-capped flight, and removed only by an explicit
  // unfollow (clearSeenTripIds); a pilot who stays followed but stops making
  // selectFeedPilotIds's lowest-MAX_PILOTS_PER_FEED cut keeps their entry forever otherwise.
  // pruneSeenTripIdsToFollowedPilots below is what actually keeps this map's pilot count real
  // — called whenever the caller (see src/features/browse-flight-feed/index.tsx) knows the
  // true, current follow set, not just the truncated subset one load fetched.
  if (serialized.length > STORED_RAW_MAX_LENGTH) {
    console.warn(
      `seen-trip-store: ${next.size} pilots' seen-trip sets serialize past the ${STORED_RAW_MAX_LENGTH}-char storage limit; not persisting.`,
    )
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    // Storage can be unavailable or full; the in-memory value still updates for this tab.
  }
}

function ensureHydrated(): ReadonlyMap<PilotId, ReadonlySet<TripId>> {
  if (!hydrated) {
    const result = readSeenTrips()
    seenTripIdsByPilot = result.ok ? result.seenTripIdsByPilot : EMPTY_SEEN_TRIPS
    hydrated = true
  }
  return seenTripIdsByPilot
}

function tripIdSetsEqual(a: ReadonlySet<TripId>, b: ReadonlySet<TripId>): boolean {
  if (a.size !== b.size) return false
  for (const tripId of a) if (!b.has(tripId)) return false
  return true
}

function seenTripsEqual(
  a: ReadonlyMap<PilotId, ReadonlySet<TripId>>,
  b: ReadonlyMap<PilotId, ReadonlySet<TripId>>,
): boolean {
  if (a.size !== b.size) return false
  for (const [pilotId, tripIds] of a) {
    const otherTripIds = b.get(pilotId)
    if (otherTripIds === undefined || !tripIdSetsEqual(tripIds, otherTripIds)) return false
  }
  return true
}

function commitIfChanged(
  next: ReadonlyMap<PilotId, ReadonlySet<TripId>>,
  previous: ReadonlyMap<PilotId, ReadonlySet<TripId>>,
): void {
  if (seenTripsEqual(next, previous)) return
  seenTripIdsByPilot = next
  hydrated = true
  writeSeenTrips(next)
}

// Same rationale as watermark-store/storage.ts's handleStorageEvent: refreshes the cached
// value so a stale in-memory read in one tab cannot re-derive replaceSeenTripIds off data
// another tab has already moved past. No subscriber list to notify.
function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return
  const result = readSeenTrips()
  if (!result.ok) return
  if (seenTripsEqual(result.seenTripIdsByPilot, seenTripIdsByPilot)) return
  seenTripIdsByPilot = result.seenTripIdsByPilot
  hydrated = true
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', handleStorageEvent)
}

// Plain read, not a hook — same rationale as watermark-store's getWatermark: the feed reads
// each pilot's remembered set once per pilot the instant that pilot's own fetch settles (see
// use-flight-feed.ts), specifically so it can be captured BEFORE recordSeenTripIds (below)
// replaces it for the same load. `null` means this pilot has no entry recorded at all — either
// truly never seen before, or every previously-remembered id has since aged out of scope (see
// replaceSeenTripIds) — both read the same way: every flight with no resolved ts classifies as
// new (see feed.ts's classifyUntrackedNewness).
export function getSeenTripIds(pilotId: PilotId): ReadonlySet<TripId> | null {
  return ensureHydrated().get(pilotId) ?? null
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
  const current = ensureHydrated()
  commitIfChanged(replaceSeenTripIds(current, pilotId, scope.fetchedTripIds, scope.renderedTripIds), current)
}

// The explicit, deliberate call unfollowing a pilot must make (see
// follow-store/use-follow-store.ts's useFollowPilot) — same rationale as watermark-store's
// clearWatermark: without it, refollowing that pilot later would compare their whole
// subsequent history against a stale remembered set from before the unfollow, instead of
// showing every flight as new again too.
export function clearSeenTripIds(pilotId: PilotId): void {
  const current = ensureHydrated()
  commitIfChanged(removeSeenTripIds(current, pilotId), current)
}

// The other route a pilot's entry can leave this map besides an explicit unfollow: this store
// (unlike watermark-store, out of scope for this fix round — see this function's own call site
// in src/features/browse-flight-feed/index.tsx) accumulates one entry per pilot who has EVER
// rendered an untracked or window-capped flight while followed, and MAX_PILOTS_PER_FEED only
// bounds how many followed pilots ONE LOAD fetches — not how many pilots this map ever holds
// (see writeSeenTrips's own doc comment for the false bound this replaces). A pilot who stays
// followed but falls out of selectFeedPilotIds's lowest-MAX_PILOTS_PER_FEED selection would
// otherwise keep a stale, never-refreshed entry forever. Pruning to the CURRENT full follow set
// (not a truncated load subset) removes exactly those pilots and no others — a still-selected
// pilot's entry is untouched, matching clearSeenTripIds's own "only the pilot actually being
// let go" guarantee.
export function pruneSeenTripIdsToFollowedPilots(followedIds: ReadonlySet<PilotId>): void {
  const current = ensureHydrated()
  const next = new Map([...current].filter(([pilotId]) => followedIds.has(pilotId)))
  commitIfChanged(next, current)
}
