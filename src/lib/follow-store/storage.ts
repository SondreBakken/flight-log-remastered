// `client-only` (the symmetric counterpart to `server-only`, already used under
// src/lib/flightlog/) is not a dependency of this project, so this file is marked with the
// 'use client' directive instead. It is a weaker guarantee: unlike server-only's guaranteed
// throw on misuse, 'use client' only forces a Server Component that imports this module into
// a client boundary, which surfaces most misuse without silently no-opping.
'use client'

import {
  addId,
  parseStoredIds,
  removeId,
  serializeIds,
  STORED_RAW_MAX_LENGTH,
  type PilotId,
  type StoredIdsRead,
} from './follow-ids'

const STORAGE_KEY = 'flight-log:followed-pilots'

const EMPTY_IDS: ReadonlySet<PilotId> = new Set()

// followedIds and hasHydrated are read together through one useSyncExternalStore call (see
// use-follow-store.ts), so they live in one object: reading them from two separate calls let
// them observe the store mid-update, which is the bug this shape rules out (issue #20).
export interface FollowStoreSnapshot {
  readonly followedIds: ReadonlySet<PilotId>
  // False for the render that must match the server (no localStorage there); flips true once
  // the real, browser-read value is available. Consumers use it to render a neutral/skeleton
  // state instead of a value indistinguishable from "genuinely not followed".
  readonly hasHydrated: boolean
}

// The server can never know the browser's followed list, so it always renders the
// same not-yet-hydrated snapshot.
const SERVER_SNAPSHOT: FollowStoreSnapshot = { followedIds: EMPTY_IDS, hasHydrated: false }

// Rebuilt only by setSnapshot — called from ensureHydrated() on first hydration, commit(), and
// handleStorageEvent() when ids actually change — so repeated getSnapshot() calls in between
// return the same reference; that's what keeps useSyncExternalStore from re-rendering (or
// looping) on every call.
let snapshot: FollowStoreSnapshot = SERVER_SNAPSHOT
const subscribers = new Set<() => void>()

function readIds(): StoredIdsRead {
  if (typeof window === 'undefined') return { ok: true, ids: new Set() }
  try {
    return parseStoredIds(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    // Safari private mode and disabled storage throw on access.
    return { ok: false }
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
    // No in-memory list exists yet to fall back on, so a failed read becomes "follows nobody" —
    // the only sensible reading before the store has ever successfully hydrated.
    const result = readIds()
    setSnapshot(result.ok ? result.ids : EMPTY_IDS)
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

function idsEqual(a: ReadonlySet<PilotId>, b: ReadonlySet<PilotId>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}

// Another tab changing the same key is the only external write we need to react to;
// other keys (or the same tab, which never fires `storage`) are none of our concern.
function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return
  const result = readIds()
  // Unlike ensureHydrated, there is a good in-memory list here worth keeping: a failed read
  // (corrupted payload, missing key, over-length payload) must not be mistaken for "the user
  // now follows nobody" and wipe it out. A genuinely empty list ("[]") is not a failed read,
  // so it still reaches the equality check below and propagates like any other change.
  if (!result.ok) return
  if (idsEqual(result.ids, snapshot.followedIds)) return
  setSnapshot(result.ids)
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

export function getSnapshot(): FollowStoreSnapshot {
  ensureHydrated()
  return snapshot
}

export function getServerSnapshot(): FollowStoreSnapshot {
  return SERVER_SNAPSHOT
}

function commitIfChanged(next: ReadonlySet<PilotId>, previous: ReadonlySet<PilotId>): void {
  if (!idsEqual(next, previous)) commit(next)
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
