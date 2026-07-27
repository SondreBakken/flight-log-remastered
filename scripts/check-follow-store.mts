import {
  addId,
  parseStoredIds,
  removeId,
  serializeIds,
  STORED_RAW_MAX_LENGTH,
  type PilotId,
} from '../src/lib/follow-store/follow-ids'
import type { FollowStoreSnapshot } from '../src/lib/follow-store/storage'

let failures = 0

function idsOf(ids: ReadonlySet<PilotId>): PilotId[] {
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

// --- storage.ts: hydration, notify-on-commit, unfollow, toggleFollow, unsubscribe, cross-tab
// sync, write guard ---
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

// The invariant this whole fix exists for: ids and hasHydrated always agree, because they come
// from one read of one object, never populated ids paired with hasHydrated: false. Applied to
// every snapshot producer (ensureHydrated, commit, handleStorageEvent) below, not just the
// first hydration, so a regression in any one of them fails this check.
function assertSnapshotConsistent(snapshot: FollowStoreSnapshot, label: string): void {
  assert(
    !(snapshot.followedIds.size > 0 && snapshot.hasHydrated === false),
    `${label}: snapshot never carries populated ids alongside hasHydrated: false`,
  )
}

class FakeLocalStorage {
  private store = new Map<string, string>()
  private throwing = false
  // Counts real reads, not snapshot rebuilds: a genuinely-hydrated store must not re-read
  // localStorage just because something asked for the snapshot again (see getItemCalls usage
  // below, which catches a storage-event handler that updates ids but leaves hasHydrated
  // false — invisible by inspecting the snapshot alone, since the next read silently
  // self-heals it, but not invisible as an extra read this counter would catch).
  getItemCalls = 0

  setThrowing(value: boolean): void {
    this.throwing = value
  }

  getItem(key: string): string | null {
    this.getItemCalls++
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

const firstSnapshot = storage.getSnapshot()
assertEqual(idsOf(firstSnapshot.followedIds), [12677], 'first getSnapshot reads the stored ids')
assert(firstSnapshot.hasHydrated === true, 'hasHydrated flips true once the store has been read')
assertSnapshotConsistent(firstSnapshot, 'getSnapshot (first hydration)')

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

// Notify-on-commit: follow
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
assertSnapshotConsistent(afterFollowSnapshot, 'getSnapshot (after follow)')

// Notify-on-commit: unfollow, symmetric with follow — removes, persists, notifies
storage.unfollow(4549)
const afterUnfollowSnapshot = storage.getSnapshot()
assertEqual(idsOf(afterUnfollowSnapshot.followedIds), [12677], 'unfollow removes the id from the in-memory snapshot')
assert(
  afterUnfollowSnapshot !== afterFollowSnapshot,
  'unfollow rebuilds the snapshot object so the removal is observable',
)
assert(notifications === 2, 'unfollow notifies subscribers exactly once')
assertEqual(
  idsOf(parseStoredIds(fakeLocalStorage.raw(STORAGE_KEY))),
  [12677],
  'unfollow persists the removal to localStorage',
)
assertSnapshotConsistent(afterUnfollowSnapshot, 'getSnapshot (after unfollow)')

// No-op guard: an invalid id to follow, or an absent id to unfollow, must not write or notify
const beforeNoopSnapshot = storage.getSnapshot()
storage.follow(-1)
storage.unfollow(999_999)
assert(notifications === 2, 'follow with an invalid id and unfollow of an absent id do not notify')
assert(
  storage.getSnapshot() === beforeNoopSnapshot,
  'follow with an invalid id and unfollow of an absent id do not rebuild the snapshot',
)
assertEqual(
  idsOf(parseStoredIds(fakeLocalStorage.raw(STORAGE_KEY))),
  [12677],
  'follow with an invalid id and unfollow of an absent id do not write to localStorage',
)

// toggleFollow: the only mutator the UI calls (FollowButton), so it needs its own coverage
// independent of follow/unfollow — both toggle directions, plus an invalid id.
storage.toggleFollow(4549)
assertEqual(idsOf(storage.getSnapshot().followedIds), [4549, 12677], 'toggleFollow adds an unfollowed id')
assert(notifications === 3, 'toggleFollow (add direction) notifies subscribers')
assertEqual(
  idsOf(parseStoredIds(fakeLocalStorage.raw(STORAGE_KEY))),
  [4549, 12677],
  'toggleFollow (add direction) persists to localStorage',
)

storage.toggleFollow(4549)
assertEqual(idsOf(storage.getSnapshot().followedIds), [12677], 'toggleFollow removes an already-followed id')
assert(notifications === 4, 'toggleFollow (remove direction) notifies subscribers')
assertEqual(
  idsOf(parseStoredIds(fakeLocalStorage.raw(STORAGE_KEY))),
  [12677],
  'toggleFollow (remove direction) persists to localStorage',
)

const beforeInvalidToggleSnapshot = storage.getSnapshot()
storage.toggleFollow(-1)
assert(notifications === 4, 'toggleFollow with an invalid id does not notify')
assert(
  storage.getSnapshot() === beforeInvalidToggleSnapshot,
  'toggleFollow with an invalid id does not rebuild the snapshot',
)

// Unsubscribe: one listener stopping must not silence a different, still-subscribed listener
let otherNotifications = 0
const unsubscribeOther = storage.subscribe(() => {
  otherNotifications++
})
unsubscribe()
storage.follow(7)
assert(notifications === 4, 'a listener stops receiving notifications once unsubscribed')
assert(otherNotifications === 1, 'unsubscribing one listener leaves another still-subscribed listener notified')
storage.unfollow(7) // undo, so the tracked set stays [12677] for what follows
unsubscribeOther()

// Cross-tab storage event
let crossTabNotifications = 0
storage.subscribe(() => {
  crossTabNotifications++
})

fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([1])))
dispatchStorageEvent(STORAGE_KEY)
const getItemCallsAfterFirstEvent = fakeLocalStorage.getItemCalls
const afterFirstCrossTabEvent = storage.getSnapshot()
assertEqual(idsOf(afterFirstCrossTabEvent.followedIds), [1], 'a storage event for our key re-reads localStorage')
assert(crossTabNotifications === 1, 'a storage event for our key notifies subscribers')
// A handler that updates the ids but leaves hasHydrated: false would be invisible by
// inspecting this snapshot: the getSnapshot() call above self-heals it via ensureHydrated
// before we ever see it. What ensureHydrated's self-heal cannot hide is the extra
// localStorage read it performs to do so — genuinely-hydrated state needs none.
assert(
  fakeLocalStorage.getItemCalls === getItemCallsAfterFirstEvent,
  'a storage event leaves the store genuinely hydrated: reading the snapshot right after triggers no further localStorage read',
)
assertSnapshotConsistent(afterFirstCrossTabEvent, 'getSnapshot (after cross-tab event for our key)')

// Another tab writing byte-identical data must not rebuild the snapshot: same reference, no
// notification, so subscribers don't re-render for a change that never actually happened.
fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([1])))
dispatchStorageEvent(STORAGE_KEY)
assert(
  storage.getSnapshot() === afterFirstCrossTabEvent,
  'a storage event whose data is unchanged from our snapshot does not rebuild the snapshot object',
)
assert(crossTabNotifications === 1, 'a storage event whose data is unchanged from our snapshot does not notify')

fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([9])))
dispatchStorageEvent('some-unrelated-app-key')
assertEqual(idsOf(storage.getSnapshot().followedIds), [1], 'a storage event for an unrelated key is ignored')
assert(crossTabNotifications === 1, 'a storage event for an unrelated key does not notify')

dispatchStorageEvent(null) // another tab calling localStorage.clear() reports key: null
const getItemCallsAfterNullKeyEvent = fakeLocalStorage.getItemCalls
const afterNullKeyEvent = storage.getSnapshot()
assertEqual(
  idsOf(afterNullKeyEvent.followedIds),
  [9],
  'a storage event with key === null (another tab cleared storage) re-reads',
)
assert(crossTabNotifications === 2, 'a storage event with key === null notifies subscribers')
assert(
  fakeLocalStorage.getItemCalls === getItemCallsAfterNullKeyEvent,
  'a storage event with key === null leaves the store genuinely hydrated: reading the snapshot right after triggers no further localStorage read',
)
assertSnapshotConsistent(afterNullKeyEvent, 'getSnapshot (after cross-tab clear event)')

// Resilience: a throwing localStorage must not crash the store
fakeLocalStorage.setThrowing(true)
dispatchStorageEvent(STORAGE_KEY)
const getItemCallsAfterThrowingEvent = fakeLocalStorage.getItemCalls
const afterThrowingEvent = storage.getSnapshot()
assertEqual(
  idsOf(afterThrowingEvent.followedIds),
  [],
  'a storage event that hits a throwing localStorage.getItem falls back to an empty set instead of crashing',
)
assert(
  fakeLocalStorage.getItemCalls === getItemCallsAfterThrowingEvent,
  'a storage event that hits a throwing localStorage.getItem still leaves the store genuinely hydrated',
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
// STORED_RAW_MAX_LENGTH must stop being persisted rather than silently overwrite (and later
// re-read as) whatever was last durably stored.
const beforeGrowth = storage.getSnapshot().followedIds.size
// Every commit that lands past the limit warns (see writeIds); expected here since crossing
// it is the point of the test, so count instead of letting it flood this script's output. The
// raw value captured at the first warning is what a correct guard must leave untouched for
// every commit after it, since none of them are allowed to reach localStorage.setItem.
let writeGuardWarnings = 0
let rawAtFirstWarning: string | null = null
const originalWarn = console.warn
console.warn = () => {
  writeGuardWarnings++
  if (rawAtFirstWarning === null) rawAtFirstWarning = fakeLocalStorage.raw(STORAGE_KEY)
}
Array.from({ length: 4_000 }, (_, index) => 10_000 + index).forEach((id) => storage.follow(id))
console.warn = originalWarn

const afterGrowth = storage.getSnapshot().followedIds
assert(afterGrowth.size === beforeGrowth + 4_000, 'the in-memory snapshot keeps every followed id for this tab')
assert(writeGuardWarnings > 0, 'crossing the write guard warns instead of failing silently')

const persistedRaw = fakeLocalStorage.raw(STORAGE_KEY)
assert(
  (persistedRaw?.length ?? 0) <= STORED_RAW_MAX_LENGTH,
  'localStorage never receives a payload past the length guard',
)
assert(
  parseStoredIds(persistedRaw).size < afterGrowth.size,
  'the oversized in-memory set is not fully persisted; some followed ids exist only for this tab session',
)
assert(
  persistedRaw === rawAtFirstWarning,
  'crossing the write guard leaves the previously persisted raw value byte-for-byte untouched, not overwritten',
)

// Late re-check: getServerSnapshot must still return the same frozen, empty, non-hydrated
// snapshot after this session has hydrated and mutated the live store extensively — proving
// it really is the separate SERVER_SNAPSHOT constant, not an alias for the live `snapshot`
// binding that would have drifted along with every follow/unfollow/toggle/storage-event above.
const serverSnapshotLateRead = storage.getServerSnapshot()
assert(
  serverSnapshotLateRead === serverSnapshotFirstRead,
  'getServerSnapshot still returns the original reference after hydration and mutation',
)
assert(
  serverSnapshotLateRead.hasHydrated === false,
  'getServerSnapshot still reports hasHydrated: false after hydration and mutation',
)
assertEqual(
  idsOf(serverSnapshotLateRead.followedIds),
  [],
  'getServerSnapshot still reports no followed ids after hydration and mutation',
)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
