// `client-only` (the symmetric counterpart to `server-only`, already used under
// src/lib/flightlog/) is not a dependency of this project, so this file is marked with the
// 'use client' directive instead. It is a weaker guarantee: unlike server-only's guaranteed
// throw on misuse, 'use client' only forces a Server Component that imports this module into
// a client boundary, which surfaces most misuse without silently no-opping.
'use client'

import { addId, parseStoredIds, removeId, serializeIds, STORED_RAW_MAX_LENGTH, type PilotId } from './follow-ids'

const STORAGE_KEY = 'flight-log:followed-pilots'

const EMPTY_IDS: ReadonlySet<PilotId> = new Set()

let hydrated = false
let currentIds: ReadonlySet<PilotId> = EMPTY_IDS
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

function ensureHydrated(): ReadonlySet<PilotId> {
  if (!hydrated) {
    currentIds = readIds()
    hydrated = true
  }
  return currentIds
}

function notifySubscribers(): void {
  subscribers.forEach((onStoreChange) => onStoreChange())
}

function commit(nextIds: ReadonlySet<PilotId>): void {
  currentIds = nextIds
  writeIds(nextIds)
  notifySubscribers()
}

// Another tab changing the same key is the only external write we need to react to;
// other keys (or the same tab, which never fires `storage`) are none of our concern.
function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return
  currentIds = readIds()
  hydrated = true
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

// Referentially stable until commit()/handleStorageEvent() swap it, which is what
// lets useSyncExternalStore avoid re-rendering on every call.
export function getSnapshot(): ReadonlySet<PilotId> {
  return ensureHydrated()
}

// The server can never know the browser's followed list, so it always renders empty.
// Returning the same object reference every time keeps useSyncExternalStore from
// treating this as a change on every call.
export function getServerSnapshot(): ReadonlySet<PilotId> {
  return EMPTY_IDS
}

// Hydration happens lazily on the first read (see ensureHydrated), so this is only
// meaningful once something has called getSnapshot/follow/unfollow/toggleFollow at least
// once. Paired with getServerHasHydrated below through the same useSyncExternalStore
// subscription that already drives getSnapshot/getServerSnapshot, so consumers can render
// a neutral state until this flips, instead of a value indistinguishable from "not followed".
export function getHasHydrated(): boolean {
  return hydrated
}

export function getServerHasHydrated(): boolean {
  return false
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
