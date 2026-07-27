// `client-only` (the symmetric counterpart to `server-only`, already used under
// src/lib/flightlog/) is not a dependency of this project, so this file is marked with the
// 'use client' directive instead. It is a weaker guarantee: unlike server-only's guaranteed
// throw on misuse, 'use client' only forces a Server Component that imports this module into
// a client boundary, which surfaces most misuse without silently no-opping.
'use client'

import { addId, parseStoredIds, removeId, serializeIds, STORED_RAW_MAX_LENGTH, type PilotId } from './follow-ids'

const STORAGE_KEY = 'flight-log:followed-pilots'

const EMPTY_IDS: ReadonlySet<PilotId> = new Set()

// followedIds and hasHydrated are read together through one useSyncExternalStore call (see
// use-follow-store.ts), so they live in one object: reading them from two separate calls let
// them observe the store mid-update, which is the bug this shape rules out (issue #20).
export interface FollowStoreSnapshot {
  followedIds: ReadonlySet<PilotId>
  hasHydrated: boolean
}

// Referentially stable module constant, never mutated: the server can never know the
// browser's followed list, so it always renders the same not-yet-hydrated snapshot.
const SERVER_SNAPSHOT: FollowStoreSnapshot = { followedIds: EMPTY_IDS, hasHydrated: false }

// Rebuilt only by setSnapshot, and only when ids actually change or hydration first happens,
// so repeated getSnapshot() calls between those events return the same reference; that's what
// keeps useSyncExternalStore from re-rendering (or looping) on every call.
let snapshot: FollowStoreSnapshot = SERVER_SNAPSHOT
const subscribers = new Set<() => void>()

function readIds(): Set<PilotId> {
  if (typeof window === 'undefined') return new Set()
  try {
    return parseStoredIds(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    // Safari private mode and disabled storage throw on access; treat as "nobody followed".
    return new Set()
  }
}

function writeIds(ids: ReadonlySet<PilotId>): void {
  if (typeof window === 'undefined') return
  const serialized = serializeIds(ids)
  // Mirror the read-side length guard: a payload past it would just parse back to an
  // empty set on next load (parseStoredIds rejects it outright), so skip persisting it
  // rather than silently lose the list. The in-memory snapshot still updates for this
  // tab; only durability across reloads is given up.
  if (serialized.length > STORED_RAW_MAX_LENGTH) {
    console.warn(
      `follow-store: ${ids.size} followed pilots serialize past the ${STORED_RAW_MAX_LENGTH}-char storage limit; not persisting.`,
    )
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized)
  } catch {
    // Storage can be unavailable or full; the in-memory snapshot still updates for this tab.
  }
}

function setSnapshot(followedIds: ReadonlySet<PilotId>): void {
  snapshot = { followedIds, hasHydrated: true }
}

function ensureHydrated(): ReadonlySet<PilotId> {
  if (!snapshot.hasHydrated) {
    setSnapshot(readIds())
  }
  return snapshot.followedIds
}

function notifySubscribers(): void {
  subscribers.forEach((onStoreChange) => onStoreChange())
}

function commit(nextIds: ReadonlySet<PilotId>): void {
  setSnapshot(nextIds)
  writeIds(nextIds)
  notifySubscribers()
}

// Another tab changing the same key is the only external write we need to react to;
// other keys (or the same tab, which never fires `storage`) are none of our concern.
function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return
  setSnapshot(readIds())
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

// Referentially stable until setSnapshot() swaps it (via commit() or handleStorageEvent()),
// which is what lets a single useSyncExternalStore call avoid re-rendering on every call.
export function getSnapshot(): FollowStoreSnapshot {
  ensureHydrated()
  return snapshot
}

export function getServerSnapshot(): FollowStoreSnapshot {
  return SERVER_SNAPSHOT
}

function commitIfChanged(next: Set<PilotId>, previous: ReadonlySet<PilotId>): void {
  // addId/removeId return a same-size copy when the id was invalid or already
  // absent/present; skip the write and subscriber notification for that no-op.
  if (next.size !== previous.size) commit(next)
}

export function follow(pilotId: PilotId): void {
  const ids = ensureHydrated()
  commitIfChanged(addId(ids, pilotId), ids)
}

export function unfollow(pilotId: PilotId): void {
  const ids = ensureHydrated()
  commitIfChanged(removeId(ids, pilotId), ids)
}

export function toggleFollow(pilotId: PilotId): void {
  const ids = ensureHydrated()
  commitIfChanged(ids.has(pilotId) ? removeId(ids, pilotId) : addId(ids, pilotId), ids)
}
