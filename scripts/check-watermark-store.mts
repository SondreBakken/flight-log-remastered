// Mirrors scripts/check-follow-store.mts's shape (see its own doc comments for the full
// rationale): watermark-store/storage.ts is gated on `typeof window` and reads/writes
// `window.localStorage` directly, so exercising it under plain node means faking just enough
// of `window` before the module is first imported (it registers a `storage` listener at
// module-eval time). Deliberately leaner than check-follow-store.mts's 800+ lines — the
// cross-tab tearing/no-op-on-byte-identical-write guarantees are already proven generically
// there against the identical code shape; this file covers what's actually NEW here: the
// strict-advance invariant, clearWatermark, and the cross-store unfollow integration.

let failures = 0

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'ok' : 'FAIL'} - ${label}`)
  if (!pass) {
    failures++
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

class FakeLocalStorage {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
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

const WATERMARK_KEY = 'flight-log:track-watermarks'

const watermarkStorage = await import('../src/lib/watermark-store/storage')

// =====================================================================================
// Hydration: lazy on first read, then cached — same contract as follow-store
// =====================================================================================

assert(watermarkStorage.getServerSnapshot().hasHydrated === false, 'the server snapshot reports hasHydrated: false')
assertEqual([...watermarkStorage.getServerSnapshot().watermarks], [], 'the server snapshot reports no watermarks')

assert(watermarkStorage.getWatermark(4549) === null, 'an unhydrated store reads a never-seen pilot as no watermark, not a crash')

// =====================================================================================
// recordSeen: the only write path that advances a watermark
// =====================================================================================

watermarkStorage.recordSeen(4549, '20260101000000')
assertEqual(watermarkStorage.getWatermark(4549), '20260101000000', 'recordSeen sets an initial watermark for a pilot with none')
assertEqual(
  JSON.parse(fakeLocalStorage.raw(WATERMARK_KEY) ?? '{}'),
  { '4549': '20260101000000' },
  'recordSeen persists the watermark to localStorage',
)

watermarkStorage.recordSeen(4549, '20260601000000')
assertEqual(watermarkStorage.getWatermark(4549), '20260601000000', 'recordSeen advances the watermark forward when the candidate is newer')

// The MUST-GO-RED case: the watermark not advancing after the feed is seen would mean this
// stays at the OLD value instead — reverting the guard inside advanceWatermark (`> current` to
// `>= current`, or dropping the call to advanceWatermark entirely) makes this line fail.
watermarkStorage.recordSeen(4549, '20250101000000') // older candidate — a stale/duplicate write
assertEqual(watermarkStorage.getWatermark(4549), '20260601000000', 'recordSeen never regresses a watermark to an OLDER candidate')

watermarkStorage.recordSeen(4549, '20260601000000') // exactly equal — must not error, must not "helpfully" move
assertEqual(watermarkStorage.getWatermark(4549), '20260601000000', 'recordSeen with a candidate exactly equal to the current value is a no-op, not an error')

let notifications = 0
const unsubscribe = watermarkStorage.subscribe(() => {
  notifications++
})
watermarkStorage.recordSeen(4549, '20260601000000') // still equal — must not notify, nothing changed
assert(notifications === 0, 'recordSeen with no actual change does not notify subscribers')
watermarkStorage.recordSeen(4549, '20270101000000')
assert(notifications === 1, 'recordSeen that actually advances the watermark notifies subscribers exactly once')
watermarkStorage.recordSeen(4549, '20250101000000') // regression attempt again — must still not notify
assert(notifications === 1, 'recordSeen that fails to advance (older candidate) does not notify subscribers')
unsubscribe()

// =====================================================================================
// clearWatermark: the explicit call unfollowing a pilot must make
// =====================================================================================

watermarkStorage.recordSeen(12677, '20260101000000')
assert(watermarkStorage.getWatermark(12677) !== null, 'sanity: pilot 12677 has a recorded watermark before clearing')

watermarkStorage.clearWatermark(12677)
assert(watermarkStorage.getWatermark(12677) === null, 'clearWatermark drops the pilot\'s watermark — a later refollow starts from scratch, not a stale mark')
assertEqual(
  JSON.parse(fakeLocalStorage.raw(WATERMARK_KEY) ?? '{}'),
  { '4549': '20270101000000' },
  'clearWatermark persists the removal to localStorage, leaving other pilots untouched',
)

const beforeNoopClear = fakeLocalStorage.raw(WATERMARK_KEY)
watermarkStorage.clearWatermark(999_999) // never had a watermark
assertEqual(fakeLocalStorage.raw(WATERMARK_KEY), beforeNoopClear, 'clearWatermark on a pilot with no stored watermark does not write')

// =====================================================================================
// Cross-tab storage event — mirrors follow-store/storage.ts's handleStorageEvent contract
// =====================================================================================

let crossTabNotifications = 0
watermarkStorage.subscribe(() => {
  crossTabNotifications++
})

fakeLocalStorage.setItem(WATERMARK_KEY, JSON.stringify({ 1: '20260101000000' }))
dispatchStorageEvent(WATERMARK_KEY)
assertEqual(watermarkStorage.getWatermark(1), '20260101000000', 'a storage event for our key re-reads localStorage')
assert(crossTabNotifications === 1, 'a storage event for our key notifies subscribers')

dispatchStorageEvent('some-unrelated-app-key')
assert(crossTabNotifications === 1, 'a storage event for an unrelated key does not notify')

fakeLocalStorage.setItem(WATERMARK_KEY, 'not json') // another tab somehow wrote a corrupt value
dispatchStorageEvent(WATERMARK_KEY)
assertEqual(
  watermarkStorage.getWatermark(1),
  '20260101000000',
  'a storage event carrying a corrupt payload keeps the last GOOD in-memory value, rather than wiping it out',
)
assert(crossTabNotifications === 1, 'a storage event carrying a corrupt payload does not notify (nothing usable changed)')

// =====================================================================================
// Corrupt / oversized stored values are REJECTED, not a crash — proven at the storage layer,
// not just the pure parser: a fresh module instance is needed so the corrupt payload is what
// FIRST hydration reads, exercising ensureHydrated's own handling of a failed read.
// =====================================================================================

async function withFreshStore(
  caseId: string,
  seed: (fake: FakeLocalStorage) => void,
): Promise<{ storage: typeof import('../src/lib/watermark-store/storage'); fakeLocalStorage: FakeLocalStorage }> {
  const fresh = new FakeLocalStorage()
  seed(fresh)
  Object.assign(globalThis, { window: makeFakeWindow(fresh, new Set()) })
  try {
    const storage = await import(`../src/lib/watermark-store/storage?case=${caseId}`)
    return { storage, fakeLocalStorage: fresh }
  } finally {
    Object.assign(globalThis, { window: mainWindow })
  }
}

for (const [label, corrupt] of [
  ['not json', 'not json'],
  ['a JSON array instead of an object', '[1,2,3]'],
  ['an oversized payload', JSON.stringify({ 1: '2'.repeat(30_000) })],
] as const) {
  let threw = false
  let hydrated: ReturnType<typeof import('../src/lib/watermark-store/storage').getSnapshot> | undefined
  try {
    const { storage } = await withFreshStore(`corrupt-${label.replace(/\s+/g, '-')}`, (fake) => fake.setItem(WATERMARK_KEY, corrupt))
    hydrated = storage.getSnapshot()
  } catch {
    threw = true
  }
  assert(!threw, `a stored value that is ${label} is rejected without throwing`)
  assert(hydrated?.hasHydrated === true, `a stored value that is ${label} still hydrates the store (rejected read = empty map, not stuck)`)
  assertEqual([...(hydrated?.watermarks ?? [])], [], `a stored value that is ${label} hydrates to an empty watermark map`)
}

// =====================================================================================
// Cross-store integration: unfollowing must drop the pilot's watermark. FollowButton
// (src/components/follow-button/index.tsx) is the one UI call site that does this — it calls
// clearWatermark(pilotId) explicitly, THEN toggles follow-store. This proves the underlying
// two-store sequence a click performs actually leaves the system in the right state, without
// needing a DOM (src/components/follow-button/index.test.tsx separately proves the component
// itself makes that exact call).
// =====================================================================================

{
  const followStorage = await import('../src/lib/follow-store/storage')
  const PILOT = 55_555

  followStorage.follow(PILOT)
  watermarkStorage.recordSeen(PILOT, '20260101000000')
  assert(followStorage.getSnapshot().followedIds.has(PILOT), 'sanity: pilot is followed before unfollowing')
  assert(watermarkStorage.getWatermark(PILOT) !== null, 'sanity: pilot has a recorded watermark before unfollowing')

  // The exact sequence FollowButton.handleToggle performs.
  watermarkStorage.clearWatermark(PILOT)
  followStorage.unfollow(PILOT)

  assert(!followStorage.getSnapshot().followedIds.has(PILOT), 'unfollow sequence: the pilot is no longer followed')
  assert(
    watermarkStorage.getWatermark(PILOT) === null,
    'unfollow sequence: the watermark is dropped — refollowing this pilot later will show their whole history as new again, not silently skip it',
  )
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
