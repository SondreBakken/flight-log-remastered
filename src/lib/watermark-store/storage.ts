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
import type { PilotId } from '@/lib/follow-store/follow-ids'

const STORAGE_KEY = 'flight-log:track-watermarks'

const EMPTY_WATERMARKS: ReadonlyMap<PilotId, Timestamp> = new Map()

// Mirrors follow-store/storage.ts's FollowStoreSnapshot: hasHydrated and the watermarks read
// together so a consumer can never observe one mid-update relative to the other.
export interface WatermarkStoreSnapshot {
  readonly watermarks: ReadonlyMap<PilotId, Timestamp>
  readonly hasHydrated: boolean
}

const SERVER_SNAPSHOT: WatermarkStoreSnapshot = { watermarks: EMPTY_WATERMARKS, hasHydrated: false }

let snapshot: WatermarkStoreSnapshot = SERVER_SNAPSHOT
const subscribers = new Set<() => void>()

function readWatermarks(): StoredWatermarksRead {
  if (typeof window === 'undefined') return { ok: false }
  try {
    return parseStoredWatermarks(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    // Safari private mode and disabled storage throw on access.
    return { ok: false }
  }
}

function writeWatermarks(watermarks: ReadonlyMap<PilotId, Timestamp>): void {
  if (typeof window === 'undefined') return
  const serialized = serializeWatermarks(watermarks)
  // Mirrors follow-store/storage.ts's writeIds guard: a payload past the limit would fail to
  // parse on next load anyway, so skip persisting it rather than silently lose the map. The
  // in-memory snapshot still updates for this tab; only durability across reloads is given up.
  if (serialized.length > STORED_RAW_MAX_LENGTH) {
    console.warn(
      `watermark-store: ${watermarks.size} pilot watermarks serialize past the ${STORED_RAW_MAX_LENGTH}-char storage limit; not persisting.`,
    )
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    // Storage can be unavailable or full; the in-memory snapshot still updates for this tab.
  }
}

function setSnapshot(watermarks: ReadonlyMap<PilotId, Timestamp>): void {
  snapshot = { watermarks, hasHydrated: true }
}

function ensureHydrated(): ReadonlyMap<PilotId, Timestamp> {
  if (!snapshot.hasHydrated) {
    const result = readWatermarks()
    setSnapshot(result.ok ? result.watermarks : EMPTY_WATERMARKS)
  }
  return snapshot.watermarks
}

function notifySubscribers(): void {
  subscribers.forEach((onStoreChange) => onStoreChange())
}

function commit(next: ReadonlyMap<PilotId, Timestamp>): void {
  setSnapshot(next)
  writeWatermarks(next)
  notifySubscribers()
}

function watermarksEqual(a: ReadonlyMap<PilotId, Timestamp>, b: ReadonlyMap<PilotId, Timestamp>): boolean {
  if (a.size !== b.size) return false
  for (const [pilotId, ts] of a) if (b.get(pilotId) !== ts) return false
  return true
}

function commitIfChanged(next: ReadonlyMap<PilotId, Timestamp>, previous: ReadonlyMap<PilotId, Timestamp>): void {
  if (!watermarksEqual(next, previous)) commit(next)
}

// Another tab changing the same key is the only external write worth reacting to — mirrors
// follow-store/storage.ts's handleStorageEvent exactly, including keeping a good in-memory map
// on a failed read rather than mistaking it for "no watermarks recorded".
function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return
  const result = readWatermarks()
  if (!result.ok) return
  if (watermarksEqual(result.watermarks, snapshot.watermarks)) return
  setSnapshot(result.watermarks)
  notifySubscribers()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', handleStorageEvent)
}

export function subscribe(onStoreChange: () => void): () => void {
  subscribers.add(onStoreChange)
  return () => {
    subscribers.delete(onStoreChange)
  }
}

export function getSnapshot(): WatermarkStoreSnapshot {
  ensureHydrated()
  return snapshot
}

export function getServerSnapshot(): WatermarkStoreSnapshot {
  return SERVER_SNAPSHOT
}

// Plain read, not a hook: the feed reads each pilot's watermark once per pilot the instant
// that pilot's own fetch settles (see use-flight-feed.ts), specifically so it can be captured
// BEFORE recordSeen (below) advances it for the same load — a reactive subscription would
// blur that ordering.
export function getWatermark(pilotId: PilotId): Timestamp | null {
  return ensureHydrated().get(pilotId) ?? null
}

// The only write path that moves a watermark forward. Called once per successfully-loaded
// pilot, after the feed has computed what "new" means against the watermark read via
// getWatermark above — see use-flight-feed.ts. advanceWatermark itself guards against ever
// moving backward, so calling this with a stale candidateTs is always safe, just a no-op.
export function recordSeen(pilotId: PilotId, candidateTs: Timestamp): void {
  const watermarks = ensureHydrated()
  commitIfChanged(advanceWatermark(watermarks, pilotId, candidateTs), watermarks)
}

// The explicit, deliberate call unfollowing a pilot must make (see components/follow-button):
// without it, refollowing that pilot later would compare their whole subsequent history
// against a stale watermark from before the unfollow, instead of showing it all as new again.
export function clearWatermark(pilotId: PilotId): void {
  const watermarks = ensureHydrated()
  commitIfChanged(removeWatermark(watermarks, pilotId), watermarks)
}
