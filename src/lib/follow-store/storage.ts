import { addId, parseStoredIds, removeId, serializeIds, type PilotId } from './follow-ids'

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
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeIds(ids))
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
  return () => subscribers.delete(onStoreChange)
}

// Referentially stable until commit()/handleStorageEvent() swap it, which is what
// lets useSyncExternalStore avoid re-rendering on every call.
export function getSnapshot(): ReadonlySet<PilotId> {
  return ensureHydrated()
}

// The server can never know the browser's followed list, so it always renders empty.
// Returning the same frozen-shape reference every time keeps React from looping.
export function getServerSnapshot(): ReadonlySet<PilotId> {
  return EMPTY_IDS
}

export function follow(pilotId: PilotId): void {
  commit(addId(ensureHydrated(), pilotId))
}

export function unfollow(pilotId: PilotId): void {
  commit(removeId(ensureHydrated(), pilotId))
}

export function toggleFollow(pilotId: PilotId): void {
  const ids = ensureHydrated()
  commit(ids.has(pilotId) ? removeId(ids, pilotId) : addId(ids, pilotId))
}
