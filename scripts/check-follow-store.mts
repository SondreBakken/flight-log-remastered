import { addId, parseStoredIds, removeId, serializeIds, STORED_RAW_MAX_LENGTH } from '../src/lib/follow-store/follow-ids'

let failures = 0

function idsOf(ids: ReadonlySet<number>): number[] {
  return [...ids].sort((a, b) => a - b)
}

function assertEqual(actual: number[], expected: number[], label: string): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'ok' : 'FAIL'} - ${label}`)
  if (!pass) {
    failures++
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

// Round-trip
assertEqual(
  idsOf(parseStoredIds(serializeIds(new Set([12677, 4549])))),
  [4549, 12677],
  'round-trips a valid id set through serialize/parse',
)

// Dedupe
assertEqual(idsOf(addId(addId(new Set(), 5), 5)), [5], 'adding the same id twice dedupes')
assertEqual(
  idsOf(parseStoredIds('[5, 5, 7]')),
  [5, 7],
  'duplicate ids in stored JSON dedupe on parse',
)

// Add / remove
assertEqual(idsOf(addId(new Set([1]), 2)), [1, 2], 'add appends a new id')
assertEqual(idsOf(removeId(new Set([1, 2]), 1)), [2], 'remove drops an id')
assertEqual(idsOf(removeId(new Set([1]), 999)), [1], 'removing an absent id is a no-op')

// Malformed / hostile input to parseStoredIds
assertEqual(idsOf(parseStoredIds(null)), [], 'null raw value parses to empty set')
assertEqual(idsOf(parseStoredIds('not json')), [], 'invalid JSON parses to empty set')
assertEqual(idsOf(parseStoredIds('{"not":"an array"}')), [], 'non-array JSON object parses to empty set')
assertEqual(idsOf(parseStoredIds('"just a string"')), [], 'JSON string (non-array) parses to empty set')
assertEqual(idsOf(parseStoredIds('42')), [], 'JSON number (non-array) parses to empty set')
assertEqual(idsOf(parseStoredIds('[1.5, 2]')), [2], 'non-integer ids are dropped')
assertEqual(idsOf(parseStoredIds('[-1, 2]')), [2], 'negative ids are dropped')
assertEqual(idsOf(parseStoredIds('[0, 2]')), [2], 'zero is dropped (not a valid pilot id)')
assertEqual(idsOf(parseStoredIds('[NaN, 2]')), [], 'NaN is not valid JSON, so the whole payload is rejected')
assertEqual(
  idsOf(parseStoredIds('[1, "two", null, 3, {}, [], true]')),
  [1, 3],
  'mixed-type array keeps only valid integer ids',
)
assertEqual(
  idsOf(parseStoredIds('[1e308]')),
  [],
  'a float past Number.MAX_SAFE_INTEGER is dropped, not coerced into a fake id',
)
assertEqual(
  idsOf(parseStoredIds('[9007199254740993]')),
  [],
  'an integer literal that rounds to an unsafe integer on JSON.parse is dropped',
)
// A string past the length guard that also happens to be invalid JSON is a false-positive
// test: it returns empty via the JSON.parse catch regardless of whether the guard exists.
// This payload is valid JSON, so it can only return empty if the length guard fires before
// JSON.parse ever runs.
const oversizedValidPayload = JSON.stringify(
  Array.from({ length: Math.ceil(STORED_RAW_MAX_LENGTH / 2) }, (_, index) => index + 1),
)
assertEqual(
  idsOf(parseStoredIds(oversizedValidPayload)),
  [],
  'valid JSON past the length guard is rejected before parsing, not because it fails to parse',
)

// Malformed / hostile input to addId itself, not just at parse time
assertEqual(idsOf(addId(new Set([1]), -5)), [1], 'addId rejects a negative id')
assertEqual(idsOf(addId(new Set([1]), 2.5)), [1], 'addId rejects a non-integer id')
assertEqual(idsOf(addId(new Set([1]), 0)), [1], 'addId rejects zero')
assertEqual(idsOf(addId(new Set([1]), Number.NaN)), [1], 'addId rejects NaN')

// --- storage.ts: hydration, notify-on-commit, unsubscribe, cross-tab sync, write guard ---
//
// storage.ts is gated on `typeof window` and reads/writes `window.localStorage` directly, so
// exercising it under plain node means faking just enough of `window`: a Map-backed
// localStorage plus a place to register the `storage` listener. `window` has to exist before
// storage.ts is first imported, since it registers that listener at module-eval time — hence
// the dynamic import below, after the fake is installed, rather than a static one at the top
// of this file.
//
// Not covered here, and why: a real `StorageEvent` dispatched through `window.dispatchEvent`,
// and genuine cross-tab OS/browser timing. Both need an actual browser (or jsdom); this file
// calls the listener storage.ts registered directly instead, which exercises the same
// `handleStorageEvent` logic without a real event object.

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

class FakeLocalStorage {
  private store = new Map<string, string>()
  private throwing = false

  setThrowing(value: boolean): void {
    this.throwing = value
  }

  getItem(key: string): string | null {
    if (this.throwing) throw new Error('storage disabled')
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.throwing) throw new Error('storage disabled')
    this.store.set(key, value)
  }

  raw(key: string): string | null {
    return this.store.get(key) ?? null
  }
}

type StorageListener = (event: { key: string | null }) => void

const fakeLocalStorage = new FakeLocalStorage()
const storageListeners = new Set<StorageListener>()

Object.assign(globalThis, {
  window: {
    localStorage: fakeLocalStorage,
    addEventListener: (type: string, listener: StorageListener) => {
      if (type === 'storage') storageListeners.add(listener)
    },
    removeEventListener: (type: string, listener: StorageListener) => {
      if (type === 'storage') storageListeners.delete(listener)
    },
  },
})

function dispatchStorageEvent(key: string | null): void {
  storageListeners.forEach((listener) => listener({ key }))
}

const STORAGE_KEY = 'flight-log:followed-pilots'

const storage = await import('../src/lib/follow-store/storage')

// --- issue #20: one snapshot object carries ids and hydration together, so they can never
// be read out of step with each other, and it must be referentially stable so
// useSyncExternalStore doesn't loop. ---

// Server snapshot: stable module constant, never claims hydration happened.
const serverSnapshotFirstRead = storage.getServerSnapshot()
assert(serverSnapshotFirstRead.hasHydrated === false, 'the server snapshot reports hasHydrated: false')
assertEqual(idsOf(serverSnapshotFirstRead.followedIds), [], 'the server snapshot reports no followed ids')
assert(
  storage.getServerSnapshot() === serverSnapshotFirstRead,
  'getServerSnapshot returns the same object reference on every call',
)

// Hydration: lazy on first read, then cached
fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([12677])))
const preHydrationSnapshot = storage.getServerSnapshot()
assert(preHydrationSnapshot.hasHydrated === false, 'hasHydrated is false before anything has read the store')

const firstSnapshot = storage.getSnapshot()
assertEqual(idsOf(firstSnapshot.followedIds), [12677], 'first getSnapshot reads the stored ids')
assert(firstSnapshot.hasHydrated === true, 'hasHydrated flips true once the store has been read')

// The invariant this whole fix exists for: ids and hasHydrated always agree, because they
// come from one read of one object, never populated ids paired with hasHydrated: false.
assert(
  !(firstSnapshot.followedIds.size > 0 && firstSnapshot.hasHydrated === false),
  'a snapshot never carries populated ids alongside hasHydrated: false',
)

fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([1, 2, 3])))
const cachedSnapshot = storage.getSnapshot()
assertEqual(
  idsOf(cachedSnapshot.followedIds),
  [12677],
  'getSnapshot after hydration returns the cached value, not a fresh localStorage read',
)
assert(
  cachedSnapshot === firstSnapshot,
  'repeated getSnapshot() calls with no intervening change return the same object reference',
)

// Notify-on-commit
let notifications = 0
const unsubscribe = storage.subscribe(() => {
  notifications++
})
const beforeFollowSnapshot = storage.getSnapshot()
storage.follow(4549)
const afterFollowSnapshot = storage.getSnapshot()
assertEqual(idsOf(afterFollowSnapshot.followedIds), [4549, 12677], 'follow adds the id to the in-memory snapshot')
assert(afterFollowSnapshot !== beforeFollowSnapshot, 'follow rebuilds the snapshot object so the new ids are observable')
assert(notifications === 1, 'follow notifies subscribers exactly once')
assertEqual(
  idsOf(parseStoredIds(fakeLocalStorage.raw(STORAGE_KEY))),
  [4549, 12677],
  'follow persists the new id to localStorage',
)

// No-op guard: an invalid id to follow, or an absent id to unfollow, must not write or notify
const beforeNoopSnapshot = storage.getSnapshot()
storage.follow(-1)
storage.unfollow(999_999)
assert(notifications === 1, 'follow with an invalid id and unfollow of an absent id do not notify')
assert(
  storage.getSnapshot() === beforeNoopSnapshot,
  'follow with an invalid id and unfollow of an absent id do not rebuild the snapshot',
)
assertEqual(
  idsOf(parseStoredIds(fakeLocalStorage.raw(STORAGE_KEY))),
  [4549, 12677],
  'follow with an invalid id and unfollow of an absent id do not write to localStorage',
)

// Unsubscribe
unsubscribe()
storage.follow(7)
assert(notifications === 1, 'a listener stops receiving notifications once unsubscribed')
storage.unfollow(7) // undo, so the tracked set stays [4549, 12677] for what follows

// Cross-tab storage event
let crossTabNotifications = 0
storage.subscribe(() => {
  crossTabNotifications++
})

fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([1])))
dispatchStorageEvent(STORAGE_KEY)
assertEqual(idsOf(storage.getSnapshot().followedIds), [1], 'a storage event for our key re-reads localStorage')
assert(crossTabNotifications === 1, 'a storage event for our key notifies subscribers')

fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([9])))
dispatchStorageEvent('some-unrelated-app-key')
assertEqual(idsOf(storage.getSnapshot().followedIds), [1], 'a storage event for an unrelated key is ignored')
assert(crossTabNotifications === 1, 'a storage event for an unrelated key does not notify')

dispatchStorageEvent(null) // another tab calling localStorage.clear() reports key: null
assertEqual(
  idsOf(storage.getSnapshot().followedIds),
  [9],
  'a storage event with key === null (another tab cleared storage) re-reads',
)
assert(crossTabNotifications === 2, 'a storage event with key === null notifies subscribers')

// Resilience: a throwing localStorage must not crash the store
fakeLocalStorage.setThrowing(true)
dispatchStorageEvent(STORAGE_KEY)
assertEqual(
  idsOf(storage.getSnapshot().followedIds),
  [],
  'a storage event that hits a throwing localStorage.getItem falls back to an empty set instead of crashing',
)

let notifiedDespiteThrow = 0
const unsubscribeThrow = storage.subscribe(() => {
  notifiedDespiteThrow++
})
storage.follow(55)
assert(
  storage.getSnapshot().followedIds.has(55),
  'a throwing localStorage.setItem still updates the in-memory snapshot for this tab',
)
assert(notifiedDespiteThrow === 1, 'a throwing localStorage.setItem still notifies subscribers')
unsubscribeThrow()
fakeLocalStorage.setThrowing(false)

// Write guard, symmetric with the read-side length guard: a followed set that serializes past
// STORED_RAW_MAX_LENGTH must stop being persisted rather than silently write (and later
// re-read as) an empty set.
const beforeGrowth = storage.getSnapshot().followedIds.size
// Every commit that lands past the limit warns (see writeIds); expected here since crossing
// it is the point of the test, so count instead of letting it flood this script's output.
let writeGuardWarnings = 0
const originalWarn = console.warn
console.warn = () => {
  writeGuardWarnings++
}
Array.from({ length: 4_000 }, (_, index) => 10_000 + index).forEach((id) => storage.follow(id))
console.warn = originalWarn

const afterGrowth = storage.getSnapshot().followedIds
assert(afterGrowth.size === beforeGrowth + 4_000, 'the in-memory snapshot keeps every followed id for this tab')
assert(writeGuardWarnings > 0, 'crossing the write guard warns instead of failing silently')

const persistedRaw = fakeLocalStorage.raw(STORAGE_KEY) ?? ''
assert(persistedRaw.length <= STORED_RAW_MAX_LENGTH, 'localStorage never receives a payload past the length guard')
assert(
  parseStoredIds(persistedRaw).size < afterGrowth.size,
  'the oversized in-memory set is not fully persisted; some followed ids exist only for this tab session',
)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
