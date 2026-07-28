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
  // is given up. In practice this should never trigger: replaceSeenTripIds bounds each
  // pilot's set to RECENT_FLIGHTS_PER_PILOT (30) ids, and the feed itself bounds pilot count
  // to MAX_PILOTS_PER_FEED (20) — a measured worst case of 20 × 30 = 600 ids serializes to
  // well under STORED_RAW_MAX_LENGTH (see check-seen-trip-store.mts).
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
// use-flight-feed.ts), specifically so it can be captured BEFORE recordSeenUntracked (below)
// replaces it for the same load. `null` means this pilot has no entry recorded at all — either
// truly never seen before, or every previously-remembered id has since aged out of scope (see
// replaceSeenTripIds) — both read the same way: every untracked flight classifies as new.
export function getSeenTripIds(pilotId: PilotId): ReadonlySet<TripId> | null {
  return ensureHydrated().get(pilotId) ?? null
}

// The only write path. See replaceSeenTripIds's own doc comment for the replace-vs-union rule
// this applies. `fetchedTripIds` is this pilot's own fetched-and-untracked scope for the load;
// `renderedTripIds` is the subset of those that actually made it into the merged, truncated
// feed (see feed.ts's fetchedUntrackedTripIdsByPilot / shownUntrackedTripIdsByPilot). Callers
// only invoke this for pilots that rendered at least one untracked entry this load (see
// use-flight-feed.ts) — a pilot contributing zero rendered entries is never called here at
// all, so their stored set is left completely untouched, the same guarantee watermark-store
// gives a pilot with zero shown tracked entries.
export function recordSeenUntracked(pilotId: PilotId, fetchedTripIds: ReadonlySet<TripId>, renderedTripIds: ReadonlySet<TripId>): void {
  const current = ensureHydrated()
  commitIfChanged(replaceSeenTripIds(current, pilotId, fetchedTripIds, renderedTripIds), current)
}

// The explicit, deliberate call unfollowing a pilot must make (see
// follow-store/use-follow-store.ts's useFollowPilot) — same rationale as watermark-store's
// clearWatermark: without it, refollowing that pilot later would compare their whole
// subsequent history against a stale remembered set from before the unfollow, instead of
// showing every untracked flight as new again too.
export function clearSeenTripIds(pilotId: PilotId): void {
  const current = ensureHydrated()
  commitIfChanged(removeSeenTripIds(current, pilotId), current)
}
