// Same 'use client' rationale as follow-store/storage.ts: this module reads/writes
// window.localStorage, so it must never run on the server.
'use client'

import {
  advanceWatermark,
  parseStoredWatermarks,
  removeWatermark,
  serializeWatermarks,
  STORED_RAW_MAX_LENGTH,
  type StoredWatermarksRead,
  type Timestamp,
} from './watermark-ids'
import type { PilotId } from '@/lib/flightlog/types'

const STORAGE_KEY = 'flight-log:track-watermarks'

const EMPTY_WATERMARKS: ReadonlyMap<PilotId, Timestamp> = new Map()

// Unlike follow-store, nothing here is read reactively — no useSyncExternalStore, no
// subscribe/notify surface (getWatermark/recordSeen/clearWatermark below are plain function
// calls; see getWatermark's own doc comment for why). So this is just two module-scope
// variables, not a FollowStoreSnapshot-shaped object: there is no consumer that could ever
// observe one out of step with the other, which is the only reason that shape exists in
// follow-store.
let hydrated = false
let watermarks: ReadonlyMap<PilotId, Timestamp> = EMPTY_WATERMARKS

function readWatermarks(): StoredWatermarksRead {
  if (typeof window === 'undefined') return { ok: false }
  try {
    return parseStoredWatermarks(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    // Safari private mode and disabled storage throw on access.
    return { ok: false }
  }
}

function writeWatermarks(next: ReadonlyMap<PilotId, Timestamp>): void {
  if (typeof window === 'undefined') return
  const serialized = serializeWatermarks(next)
  // Mirrors follow-store/storage.ts's writeIds guard: a payload past the limit would fail to
  // parse on next load anyway, so skip persisting it rather than silently lose the map. The
  // in-memory value still updates for this tab; only durability across reloads is given up.
  if (serialized.length > STORED_RAW_MAX_LENGTH) {
    console.warn(
      `watermark-store: ${next.size} pilot watermarks serialize past the ${STORED_RAW_MAX_LENGTH}-char storage limit; not persisting.`,
    )
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    // Storage can be unavailable or full; the in-memory value still updates for this tab.
  }
}

function ensureHydrated(): ReadonlyMap<PilotId, Timestamp> {
  if (!hydrated) {
    const result = readWatermarks()
    watermarks = result.ok ? result.watermarks : EMPTY_WATERMARKS
    hydrated = true
  }
  return watermarks
}

function watermarksEqual(a: ReadonlyMap<PilotId, Timestamp>, b: ReadonlyMap<PilotId, Timestamp>): boolean {
  if (a.size !== b.size) return false
  for (const [pilotId, ts] of a) if (b.get(pilotId) !== ts) return false
  return true
}

function commitIfChanged(next: ReadonlyMap<PilotId, Timestamp>, previous: ReadonlyMap<PilotId, Timestamp>): void {
  if (watermarksEqual(next, previous)) return
  watermarks = next
  hydrated = true
  writeWatermarks(next)
}

// Another tab changing the same key is the only external write worth reacting to. Kept even
// though nothing here subscribes reactively (see the module doc comment above): getWatermark/
// recordSeen/clearWatermark all read the cached `watermarks` value rather than localStorage
// directly, so without this, a stale in-memory cache in one tab could re-derive
// advanceWatermark off data another tab has already moved past, and silently write a
// regression back to localStorage. This only refreshes that cache; there is no subscriber list
// to notify.
function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return
  const result = readWatermarks()
  if (!result.ok) return
  if (watermarksEqual(result.watermarks, watermarks)) return
  watermarks = result.watermarks
  hydrated = true
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', handleStorageEvent)
}

// Plain read, not a hook: the feed reads each pilot's watermark once per pilot the instant
// that pilot's own fetch settles (see use-flight-feed.ts), specifically so it can be captured
// BEFORE recordSeen (below) advances it for the same load — a reactive subscription would
// blur that ordering, and nothing in this app needs a component to re-render when a watermark
// changes (unlike follow-store's followedIds, which drive the UI directly).
export function getWatermark(pilotId: PilotId): Timestamp | null {
  return ensureHydrated().get(pilotId) ?? null
}

// The only write path that moves a watermark forward. Called once per load, for each pilot
// whose SHOWN entries advanced their watermark — see use-flight-feed.ts and feed.ts's
// shownTrackedTsByPilot. advanceWatermark itself guards against ever moving backward, so
// calling this with a stale candidateTs is always safe, just a no-op.
export function recordSeen(pilotId: PilotId, candidateTs: Timestamp): void {
  const current = ensureHydrated()
  commitIfChanged(advanceWatermark(current, pilotId, candidateTs), current)
}

// The explicit, deliberate call unfollowing a pilot must make (see
// follow-store/use-follow-store.ts's useFollowPilot): without it, refollowing that pilot later
// would compare their whole subsequent history against a stale watermark from before the
// unfollow, instead of showing it all as new again.
export function clearWatermark(pilotId: PilotId): void {
  const current = ensureHydrated()
  commitIfChanged(removeWatermark(current, pilotId), current)
}
