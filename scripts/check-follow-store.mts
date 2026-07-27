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

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

// parseStoredIds now reports success/failure separately from the ids themselves (issue #25):
// a structurally unusable payload (null, invalid JSON, wrong shape, over length) is a failed
// read, distinct from a structurally valid array that happens to contain zero valid ids.
// These two helpers keep that distinction visible at each call site instead of collapsing it.
function assertParsedIds(raw: string | null, expected: number[], label: string): void {
  const result = parseStoredIds(raw)
  if (!result.ok) {
    failures++
    console.log(`FAIL - ${label}`)
    console.error(`  expected a successful read with ids ${JSON.stringify(expected)}, got a failed read`)
    return
  }
  assertEqual(idsOf(result.ids), expected, label)
}

function assertParseFails(raw: string | null, label: string): void {
  const result = parseStoredIds(raw)
  const pass = !result.ok
  console.log(`${pass ? 'ok' : 'FAIL'} - ${label}`)
  if (!pass) {
    failures++
    console.error(`  expected a failed read, got a successful read`)
  }
}

// Reused by assertions that check what actually landed in localStorage after a commit: those
// payloads are always ones this module itself just wrote, so a failed parse here would mean
// the test fixture is broken, not that the read path under test misbehaved.
function idsOfPersisted(raw: string | null): PilotId[] {
  const result = parseStoredIds(raw)
  if (!result.ok) throw new Error('expected a persisted raw value to parse successfully')
  return idsOf(result.ids)
}

// A string past the length guard that also happens to be invalid JSON would be a false-positive
// fixture: it fails to parse regardless of whether the length guard exists. This payload is
// valid JSON, so it can only fail because the length guard fires before JSON.parse ever runs.
// Defined early so it can seed both the parseStoredIds unit tests below and the fresh-hydration
// tests further down.
const oversizedValidPayload = JSON.stringify(
  Array.from({ length: Math.ceil(STORED_RAW_MAX_LENGTH / 2) }, (_, index) => index + 1),
)

// Round-trip
assertParsedIds(serializeIds(new Set([12677, 4549])), [4549, 12677], 'round-trips a valid id set through serialize/parse')

// Dedupe
assertEqual(idsOf(addId(addId(new Set(), 5), 5)), [5], 'adding the same id twice dedupes')
assertParsedIds('[5, 5, 7]', [5, 7], 'duplicate ids in stored JSON dedupe on parse')

// Add / remove
assertEqual(idsOf(addId(new Set([1]), 2)), [1, 2], 'add appends a new id')
assertEqual(idsOf(removeId(new Set([1, 2]), 1)), [2], 'remove drops an id')
assertEqual(idsOf(removeId(new Set([1]), 999)), [1], 'removing an absent id is a no-op')

// Structurally unusable input to parseStoredIds: these must report a failed read (ok: false),
// not a valid-but-empty one. That distinction is the fix for issue #25 — see storage.ts's
// ensureHydrated and handleStorageEvent for the two different things each caller does with it.
assertParseFails(null, 'a null raw value fails to parse')
assertParseFails('not json', 'invalid JSON fails to parse')
assertParseFails('{"not":"an array"}', 'a non-array JSON object fails to parse')
assertParseFails('"just a string"', 'a JSON string (non-array) fails to parse')
assertParseFails('42', 'a JSON number (non-array) fails to parse')
assertParseFails('[NaN, 2]', 'NaN is not valid JSON, so the whole payload fails to parse')
assertParseFails(
  oversizedValidPayload,
  'valid JSON past the length guard fails to parse — rejected for its length, not because JSON.parse rejects it',
)

// A structurally valid array is a successful read even when every element in it gets filtered
// out as an invalid id: that is "the user follows nobody", not "the read failed".
assertParsedIds('[1.5, 2]', [2], 'non-integer ids are dropped from an otherwise-successful read')
assertParsedIds('[-1, 2]', [2], 'negative ids are dropped from an otherwise-successful read')
assertParsedIds('[0, 2]', [2], 'zero is dropped (not a valid pilot id) from an otherwise-successful read')
assertParsedIds(
  '[1, "two", null, 3, {}, [], true]',
  [1, 3],
  'a mixed-type array keeps only valid integer ids and still succeeds',
)
assertParsedIds(
  '[1e308]',
  [],
  'a float past Number.MAX_SAFE_INTEGER is dropped, not coerced into a fake id, and the read still succeeds',
)
assertParsedIds(
  '[9007199254740993]',
  [],
  'an integer literal that rounds to an unsafe integer on JSON.parse is dropped and the read still succeeds',
)

// Boundary: exactly at the limit, not past it, must still parse ('>' is the correct check
// against STORED_RAW_MAX_LENGTH, not '>='). Trailing spaces are legal JSON whitespace and
// JSON.parse ignores them, so padding a small valid array out to exactly the limit produces a
// payload that is both valid JSON and exactly STORED_RAW_MAX_LENGTH chars long — landing
// precisely on the boundary instead of merely near it.
const exactLimitBase = JSON.stringify([11_111, 22_222])
const exactLimitPayload = exactLimitBase + ' '.repeat(STORED_RAW_MAX_LENGTH - exactLimitBase.length)
assertParsedIds(
  exactLimitPayload,
  [11_111, 22_222],
  'a payload exactly at the length guard boundary still succeeds (the guard rejects past the limit, not at it)',
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

class FakeLocalStorage {
  private store = new Map<string, string>()
  private throwing = false
  // Counts real reads, not snapshot rebuilds: a genuinely-hydrated store must not re-read
  // localStorage just because something asked for the snapshot again (see getItemCalls usage
  // below, which catches a storage-event handler that updates ids but leaves hasHydrated
  // false — invisible by inspecting the snapshot alone, since the next read silently
  // self-heals it, but not invisible as an extra read this counter would catch).
  getItemCalls = 0
  // Counts real writes. The write guard's whole point is that an over-limit commit must
  // reach neither this counter nor `store` (see the write-guard section below, which reads
  // this instead of trusting the persisted raw value alone — a mutation that clobbers the
  // raw value with something that happens to match what a correct guard would have left
  // behind is invisible to a raw-value comparison but not to a call count).
  setItemCalls = 0

  setThrowing(value: boolean): void {
    this.throwing = value
  }

  getItem(key: string): string | null {
    this.getItemCalls++
    if (this.throwing) throw new Error('storage disabled')
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.setItemCalls++
    if (this.throwing) throw new Error('storage disabled')
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    if (this.throwing) throw new Error('storage disabled')
    this.store.delete(key)
  }

  raw(key: string): string | null {
    return this.store.get(key) ?? null
  }
}

type StorageListener = (event: { key: string | null }) => void

function makeFakeWindow(fake: FakeLocalStorage, listeners: Set<StorageListener>) {
  return {
    localStorage: fake,
    addEventListener: (type: string, listener: StorageListener) => {
      if (type === 'storage') listeners.add(listener)
    },
    removeEventListener: (type: string, listener: StorageListener) => {
      if (type === 'storage') listeners.delete(listener)
    },
  }
}

const fakeLocalStorage = new FakeLocalStorage()
const storageListeners = new Set<StorageListener>()
const mainWindow = makeFakeWindow(fakeLocalStorage, storageListeners)

Object.assign(globalThis, { window: mainWindow })

function dispatchStorageEvent(key: string | null): void {
  storageListeners.forEach((listener) => listener({ key }))
}

// Bundles "capture the counter" and "perform the read being measured" into one call, so the
// two can't drift apart: sampling the counter on a line before the read it's meant to bracket
// (as opposed to inside the same closure) lets anything inserted in between — even an
// unrelated assertion — silently start measuring the wrong thing.
function readItemCallsDuring(fake: FakeLocalStorage, action: () => void): number {
  const before = fake.getItemCalls
  action()
  return fake.getItemCalls - before
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

// --- issue #25: ensureHydrated is the caller for which a failed read must still count as
// "hydrated, follows nobody" — there is no in-memory list yet to prefer. This is the opposite
// choice from handleStorageEvent (tested further down), so it needs its own module instance:
// hasHydrated flips true permanently on the first hydration, so testing "first hydration"
// against each of the three failure inputs needs three fresh stores, each seeded with one
// input before its first read. A distinct `?case=` query string forces tsx to evaluate a new
// module instance instead of returning the already-hydrated one from its module cache.
async function assertFreshHydrationFailsToEmpty(
  caseId: string,
  seed: (fake: FakeLocalStorage) => void,
  label: string,
): Promise<void> {
  const freshFakeLocalStorage = new FakeLocalStorage()
  const freshListeners = new Set<StorageListener>()
  seed(freshFakeLocalStorage)
  // window has to stay pointed at the fresh fake for every call the fresh module makes below —
  // readIds() reads `window.localStorage` fresh each call rather than capturing it at import
  // time, so restoring the main window too early would silently make these assertions read
  // (and pass against) the shared fake instead of the one this test seeded.
  Object.assign(globalThis, { window: makeFakeWindow(freshFakeLocalStorage, freshListeners) })
  const freshStorage = await import(`../src/lib/follow-store/storage?case=${caseId}`)

  const first = freshStorage.getSnapshot()
  assertEqual(idsOf(first.followedIds), [], `${label}: first hydration against a failed read yields an empty list`)
  assert(first.hasHydrated === true, `${label}: first hydration against a failed read still marks the store hydrated`)

  // A mutant that "preserves" on a failed read by skipping setSnapshot instead of applying
  // EMPTY_IDS would leave hasHydrated false forever, so every later getSnapshot() call would
  // re-attempt the read. hasHydrated alone can't catch that (it self-heals on the very next
  // read); this counts the second call's reads, which a genuinely hydrated store makes zero of.
  const readsOnSecondCall = readItemCallsDuring(freshFakeLocalStorage, () => {
    freshStorage.getSnapshot()
  })
  assert(
    readsOnSecondCall === 0,
    `${label}: a second getSnapshot() after a failed first hydration does not re-read localStorage — the store is genuinely hydrated, not stuck retrying`,
  )

  Object.assign(globalThis, { window: mainWindow })
}

await assertFreshHydrationFailsToEmpty(
  'hydrate-malformed',
  (fake) => fake.setItem(STORAGE_KEY, 'not json'),
  'a malformed payload present before first hydration',
)
await assertFreshHydrationFailsToEmpty(
  'hydrate-missing-key',
  () => {}, // key never written, so getItem returns null
  'a missing key before first hydration',
)
await assertFreshHydrationFailsToEmpty(
  'hydrate-oversized',
  (fake) => fake.setItem(STORAGE_KEY, oversizedValidPayload),
  'an over-limit payload present before first hydration',
)

// Hydration: lazy on first read, then cached
fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([12677])))

const firstSnapshot = storage.getSnapshot()
assertEqual(idsOf(firstSnapshot.followedIds), [12677], 'first getSnapshot reads the stored ids')
assert(firstSnapshot.hasHydrated === true, 'hasHydrated flips true once the store has been read')

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
assertEqual(idsOfPersisted(fakeLocalStorage.raw(STORAGE_KEY)), [4549, 12677], 'follow persists the new id to localStorage')

// Notify-on-commit: unfollow, symmetric with follow — removes, persists, notifies
storage.unfollow(4549)
const afterUnfollowSnapshot = storage.getSnapshot()
assertEqual(idsOf(afterUnfollowSnapshot.followedIds), [12677], 'unfollow removes the id from the in-memory snapshot')
assert(
  afterUnfollowSnapshot !== afterFollowSnapshot,
  'unfollow rebuilds the snapshot object so the removal is observable',
)
assert(notifications === 2, 'unfollow notifies subscribers exactly once')
assertEqual(idsOfPersisted(fakeLocalStorage.raw(STORAGE_KEY)), [12677], 'unfollow persists the removal to localStorage')

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
  idsOfPersisted(fakeLocalStorage.raw(STORAGE_KEY)),
  [12677],
  'follow with an invalid id and unfollow of an absent id do not write to localStorage',
)

// toggleFollow: the only mutator the UI calls (FollowButton), so it needs its own coverage
// independent of follow/unfollow — both toggle directions, plus an invalid id.
storage.toggleFollow(4549)
assertEqual(idsOf(storage.getSnapshot().followedIds), [4549, 12677], 'toggleFollow adds an unfollowed id')
assert(notifications === 3, 'toggleFollow (add direction) notifies subscribers')
assertEqual(
  idsOfPersisted(fakeLocalStorage.raw(STORAGE_KEY)),
  [4549, 12677],
  'toggleFollow (add direction) persists to localStorage',
)

storage.toggleFollow(4549)
assertEqual(idsOf(storage.getSnapshot().followedIds), [12677], 'toggleFollow removes an already-followed id')
assert(notifications === 4, 'toggleFollow (remove direction) notifies subscribers')
assertEqual(
  idsOfPersisted(fakeLocalStorage.raw(STORAGE_KEY)),
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

// Tearing (issue #20): useSyncExternalStore reads getSnapshot() synchronously from inside the
// listener it registers via subscribe(), so a subscriber notified before the snapshot is
// rebuilt would render the id it just saw committed alongside a snapshot that still reflects
// the old state. Prove commit() rebuilds the snapshot before it notifies, not after, by
// reading getSnapshot() from inside the callback itself.
let idsSeenInsideCommitCallback: PilotId[] = []
const unsubscribeCommitTearing = storage.subscribe(() => {
  idsSeenInsideCommitCallback = idsOf(storage.getSnapshot().followedIds)
})
storage.follow(31_415)
assert(
  idsSeenInsideCommitCallback.includes(31_415),
  'a subscriber reading getSnapshot() inside its own callback already sees the id just committed',
)
unsubscribeCommitTearing()
storage.unfollow(31_415) // undo, so the tracked set stays [12677] for what follows

// Cross-tab storage event
let crossTabNotifications = 0
storage.subscribe(() => {
  crossTabNotifications++
})

fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([1])))
dispatchStorageEvent(STORAGE_KEY)
let afterFirstCrossTabEvent!: FollowStoreSnapshot
// A handler that updates the ids but leaves hasHydrated: false would be invisible by
// inspecting this snapshot: the getSnapshot() call self-heals it via ensureHydrated before we
// ever see it. What ensureHydrated's self-heal cannot hide is the extra localStorage read it
// performs to do so — genuinely-hydrated state needs none.
const itemCallsDuringFirstEventRead = readItemCallsDuring(fakeLocalStorage, () => {
  afterFirstCrossTabEvent = storage.getSnapshot()
})
assertEqual(idsOf(afterFirstCrossTabEvent.followedIds), [1], 'a storage event for our key re-reads localStorage')
assert(crossTabNotifications === 1, 'a storage event for our key notifies subscribers')
assert(
  itemCallsDuringFirstEventRead === 0,
  'a storage event leaves the store genuinely hydrated: reading the snapshot right after triggers no further localStorage read',
)

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
let afterNullKeyEvent!: FollowStoreSnapshot
const itemCallsDuringNullKeyEventRead = readItemCallsDuring(fakeLocalStorage, () => {
  afterNullKeyEvent = storage.getSnapshot()
})
assertEqual(
  idsOf(afterNullKeyEvent.followedIds),
  [9],
  'a storage event with key === null (another tab cleared storage) re-reads',
)
assert(crossTabNotifications === 2, 'a storage event with key === null notifies subscribers')
assert(
  itemCallsDuringNullKeyEventRead === 0,
  'a storage event with key === null leaves the store genuinely hydrated: reading the snapshot right after triggers no further localStorage read',
)

// Tearing (issue #20): same guarantee as the commit-path tearing test above, but for the
// cross-tab path — a subscriber notified of a storage event must already see the new ids if
// it calls getSnapshot() synchronously inside its own callback.
let idsSeenInsideStorageEventCallback: PilotId[] = []
const unsubscribeStorageEventTearing = storage.subscribe(() => {
  idsSeenInsideStorageEventCallback = idsOf(storage.getSnapshot().followedIds)
})
fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([27_182])))
dispatchStorageEvent(STORAGE_KEY)
assert(
  idsSeenInsideStorageEventCallback.includes(27_182),
  'a subscriber reading getSnapshot() inside its own callback already sees the cross-tab id just applied',
)
unsubscribeStorageEventTearing()

// handleStorageEvent input paths not otherwise exercised above. First re-sync to a known,
// two-id baseline so each case below is judged against a known starting point rather than
// whatever the tests above happened to leave behind.
fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([7, 9])))
dispatchStorageEvent(STORAGE_KEY)
const handlerPathBaseline = storage.getSnapshot()
assertEqual(idsOf(handlerPathBaseline.followedIds), [7, 9], 'handleStorageEvent input paths: baseline is [7, 9]')
let handlerPathNotifications = 0
const unsubscribeHandlerPath = storage.subscribe(() => {
  handlerPathNotifications++
})

// Reordered payload: same set, different array order — parseStoredIds produces the same set,
// so idsEqual must treat this as no change at all.
fakeLocalStorage.setItem(STORAGE_KEY, JSON.stringify([9, 7]))
dispatchStorageEvent(STORAGE_KEY)
assert(
  storage.getSnapshot() === handlerPathBaseline,
  'a reordered but set-equal cross-tab payload does not rebuild the snapshot',
)
assert(handlerPathNotifications === 0, 'a reordered but set-equal cross-tab payload does not notify')

// Duplicate ids: parseStoredIds dedupes on parse, so this is also a same-set no-op.
fakeLocalStorage.setItem(STORAGE_KEY, JSON.stringify([9, 7, 7, 9]))
dispatchStorageEvent(STORAGE_KEY)
assert(
  storage.getSnapshot() === handlerPathBaseline,
  'a cross-tab payload with duplicate ids of the same set does not rebuild the snapshot',
)
assert(handlerPathNotifications === 0, 'a cross-tab payload with duplicate ids of the same set does not notify')

// Malformed payload arriving cross-tab while we hold a good in-memory list (issue #25):
// parseStoredIds reports a failed read, and handleStorageEvent must keep the current list
// rather than mistake "failed to read" for "the user now follows nobody".
fakeLocalStorage.setItem(STORAGE_KEY, 'not json')
dispatchStorageEvent(STORAGE_KEY)
assert(
  storage.getSnapshot() === handlerPathBaseline,
  'a malformed cross-tab payload does not rebuild the snapshot; the good in-memory list is kept',
)
assertEqual(
  idsOf(storage.getSnapshot().followedIds),
  [7, 9],
  'a malformed cross-tab payload leaves the in-memory list untouched',
)
assert(handlerPathNotifications === 0, 'a malformed cross-tab payload does not notify subscribers')

// Key removed (another tab cleared just our key, so getItem returns null): readIds() sees
// parseStoredIds(null), the same failed-read outcome as a malformed payload, so it is kept too.
fakeLocalStorage.removeItem(STORAGE_KEY)
dispatchStorageEvent(STORAGE_KEY)
assert(
  storage.getSnapshot() === handlerPathBaseline,
  'a cross-tab key removal does not rebuild the snapshot; the good in-memory list is kept',
)
assertEqual(
  idsOf(storage.getSnapshot().followedIds),
  [7, 9],
  'a cross-tab key removal leaves the in-memory list untouched',
)
assert(handlerPathNotifications === 0, 'a cross-tab key removal does not notify subscribers')

// Payload past STORED_RAW_MAX_LENGTH arriving cross-tab: parseStoredIds rejects it by length
// before ever parsing, the same failed-read outcome as above, so it is kept too. Reuses
// oversizedValidPayload (defined above): valid JSON, rejected purely for its length, so this
// exercises the length guard specifically rather than a JSON.parse failure.
fakeLocalStorage.setItem(STORAGE_KEY, oversizedValidPayload)
dispatchStorageEvent(STORAGE_KEY)
assert(
  storage.getSnapshot() === handlerPathBaseline,
  'an over-limit cross-tab payload does not rebuild the snapshot; the good in-memory list is kept',
)
assertEqual(
  idsOf(storage.getSnapshot().followedIds),
  [7, 9],
  'an over-limit cross-tab payload leaves the in-memory list untouched',
)
assert(handlerPathNotifications === 0, 'an over-limit cross-tab payload does not notify subscribers')

// A genuinely empty list ("[]") is a successful read, not a failed one, so it must still
// propagate cross-tab: unfollowing your last pilot in another tab must reach this tab too,
// not get swallowed by the same guard that protects against corrupted payloads.
fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set()))
dispatchStorageEvent(STORAGE_KEY)
assertEqual(idsOf(storage.getSnapshot().followedIds), [], 'a genuinely empty cross-tab payload is applied')
assert(handlerPathNotifications === 1, 'a genuinely empty cross-tab payload notifies subscribers')

unsubscribeHandlerPath()

// Resilience: a throwing localStorage must not crash the store, and — per the same failed-read
// contract proven above — must not wipe the in-memory list either. Re-sync to a non-empty
// baseline first: the previous test left the list genuinely empty, which would make "wiped" and
// "preserved" indistinguishable.
fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(new Set([21])))
dispatchStorageEvent(STORAGE_KEY)
const beforeThrowingEvent = storage.getSnapshot()
assertEqual(idsOf(beforeThrowingEvent.followedIds), [21], 'resilience baseline is [21] before the throwing storage event')

fakeLocalStorage.setThrowing(true)
dispatchStorageEvent(STORAGE_KEY)
let afterThrowingEvent!: FollowStoreSnapshot
const itemCallsDuringThrowingEventRead = readItemCallsDuring(fakeLocalStorage, () => {
  afterThrowingEvent = storage.getSnapshot()
})
assert(
  afterThrowingEvent === beforeThrowingEvent,
  'a storage event that hits a throwing localStorage.getItem does not rebuild the snapshot; the good in-memory list is kept',
)
assertEqual(
  idsOf(afterThrowingEvent.followedIds),
  [21],
  'a storage event that hits a throwing localStorage.getItem leaves the in-memory list untouched instead of wiping it',
)
assert(
  itemCallsDuringThrowingEventRead === 0,
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
// it is the point of the test, so count instead of letting it flood this script's output.
let writeGuardWarnings = 0
const originalWarn = console.warn
console.warn = () => {
  writeGuardWarnings++
}

// Sampling the persisted raw value only once — after the loop, or at the first warning — can't
// tell a correct guard from one that clobbers storage on every over-limit commit: if every
// clobber happens to write the same bytes (e.g. always '[]'), the "before" and "after" samples
// agree even though every single commit destroyed real data. So each commit is bracketed
// individually: capture setItemCalls and the raw value right before it, and if that commit
// warned (i.e. it was over the limit), assert neither changed as a result of it — regardless
// of whether a hostile write happens before or after the warn call within that commit.
let overLimitCommits = 0
let overLimitCommitWroteToStorage = false
let rawWhenGuardFirstTriggered: string | null = null
for (const id of Array.from({ length: 4_000 }, (_, index) => 10_000 + index)) {
  const setItemCallsBefore = fakeLocalStorage.setItemCalls
  const rawBefore = fakeLocalStorage.raw(STORAGE_KEY)
  const warningsBefore = writeGuardWarnings
  storage.follow(id)
  const guardTriggeredForThisCommit = writeGuardWarnings > warningsBefore
  if (!guardTriggeredForThisCommit) continue
  overLimitCommits++
  if (rawWhenGuardFirstTriggered === null) rawWhenGuardFirstTriggered = rawBefore
  if (fakeLocalStorage.setItemCalls !== setItemCallsBefore || fakeLocalStorage.raw(STORAGE_KEY) !== rawBefore) {
    overLimitCommitWroteToStorage = true
  }
}
console.warn = originalWarn

const afterGrowth = storage.getSnapshot().followedIds
assert(afterGrowth.size === beforeGrowth + 4_000, 'the in-memory snapshot keeps every followed id for this tab')
assert(overLimitCommits > 0, 'crossing the write guard warns instead of failing silently')
assert(
  !overLimitCommitWroteToStorage,
  'no over-limit commit calls localStorage.setItem or changes the persisted raw value, even one that writes bytes matching what a correct guard would have left behind',
)

const persistedRaw = fakeLocalStorage.raw(STORAGE_KEY)
assert(
  (persistedRaw?.length ?? 0) <= STORED_RAW_MAX_LENGTH,
  'localStorage never receives a payload past the length guard',
)
const persistedResult = parseStoredIds(persistedRaw)
assert(persistedResult.ok, 'the persisted raw value after the write guard triggers still parses successfully')
assert(
  persistedResult.ok && persistedResult.ids.size < afterGrowth.size,
  'the oversized in-memory set is not fully persisted; some followed ids exist only for this tab session',
)
assert(
  persistedRaw === rawWhenGuardFirstTriggered,
  'crossing the write guard leaves the previously persisted raw value byte-for-byte untouched, not overwritten',
)

// Boundary: exactly at the limit, not past it, must still persist ('>' is the correct check
// against STORED_RAW_MAX_LENGTH, not '>='). Re-sync to a fresh, known state via the cross-tab
// path first (bypasses the write guard, since handleStorageEvent never calls writeIds), then
// commit one more id that brings the serialized payload to exactly STORED_RAW_MAX_LENGTH
// chars: 2857 six-digit ids serialize to exactly 2857 * 7 + 1 = 20000 chars ('[', ']', a comma
// between each pair, and 6 digits per id).
const boundaryBaseIds = new Set(Array.from({ length: 2_856 }, (_, index) => 100_000 + index))
fakeLocalStorage.setItem(STORAGE_KEY, serializeIds(boundaryBaseIds))
dispatchStorageEvent(STORAGE_KEY)
assert(
  storage.getSnapshot().followedIds.size === boundaryBaseIds.size,
  'write guard boundary: re-synced to the 2,856-id base state via the cross-tab path',
)

const setItemCallsBeforeBoundaryCommit = fakeLocalStorage.setItemCalls
let boundaryCommitWarned = false
console.warn = () => {
  boundaryCommitWarned = true
}
storage.follow(102_856) // brings the set to exactly 2,857 ids, serializing to exactly the limit
console.warn = originalWarn

const boundaryPersistedRaw = fakeLocalStorage.raw(STORAGE_KEY)
assert(
  boundaryPersistedRaw !== null && boundaryPersistedRaw.length === STORED_RAW_MAX_LENGTH,
  'write guard boundary: the exact-length payload really is exactly STORED_RAW_MAX_LENGTH chars',
)
assert(!boundaryCommitWarned, 'a commit that serializes to exactly STORED_RAW_MAX_LENGTH chars does not warn')
assert(
  fakeLocalStorage.setItemCalls === setItemCallsBeforeBoundaryCommit + 1,
  'a commit that serializes to exactly STORED_RAW_MAX_LENGTH chars is still persisted, not rejected as if it were over the limit',
)
assertEqual(
  idsOfPersisted(boundaryPersistedRaw),
  idsOf(new Set([...boundaryBaseIds, 102_856])),
  'a commit that serializes to exactly STORED_RAW_MAX_LENGTH chars persists the full id set',
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
