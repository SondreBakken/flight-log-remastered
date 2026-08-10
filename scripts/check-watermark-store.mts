// Mirrors scripts/check-follow-store.mts's shape (see its own doc comments for the full
// rationale): watermark-store/storage.ts is gated on `typeof window` and reads/writes
// `window.localStorage` directly, so exercising it under plain node means faking just enough
// of `window` before the module is first imported (it registers a `storage` listener at
// module-eval time).
//
// Deliberately does NOT re-derive follow-store's own coverage from scratch: it duplicates code
// SHAPE (hydrate-on-first-read, commit-if-changed, cross-tab listener), but that shape being
// proven correct once, generically, at follow-store does not carry over here — coverage binds
// to a module instance, not a pattern. Every guarantee this file's own production code claims
// (the read/write length guards, the cross-tab key filter, the null-key case, the strict-advance
// invariant, clearWatermark, and the cross-store unfollow integration) is proven again here,
// against THIS module, with its own mutation-tested fixtures — see the blocking-4 fix-round
// finding this file's history records for what was missing before and why each fixture below is
// shaped the way it is.

import { STORED_RAW_MAX_LENGTH } from '../src/lib/watermark-store/watermark-ids'

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
  private throwing = false
  // Counts real reads/writes, not just whatever the module's own cache says — a mutation that
  // makes the module "look" cached (e.g. by returning the right VALUE without actually
  // skipping the extra read/write) is invisible to a value comparison alone but not to these
  // counters. See the boundary-guard sections below, which lean on setItemCalls specifically.
  getItemCalls = 0
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

const WATERMARK_KEY = 'flight-log:track-watermarks'

// Bundles "capture the counter" and "perform the read/write being measured" into one call, so
// the two can't drift apart — see check-follow-store.mts's readItemCallsDuring for the same
// rationale.
function itemCallsDuring(action: () => void): { reads: number; writes: number } {
  const readsBefore = fakeLocalStorage.getItemCalls
  const writesBefore = fakeLocalStorage.setItemCalls
  action()
  return { reads: fakeLocalStorage.getItemCalls - readsBefore, writes: fakeLocalStorage.setItemCalls - writesBefore }
}

// A payload that is REJECTED ONLY because of its length: every entry is a real pilot id mapped
// to a real 14-digit timestamp, so this can only fail via the length guard, never via the
// per-entry validation path — unlike the pre-fix-round fixture (`{1: '2'.repeat(N)}`), whose
// VALUE was never a valid timestamp to begin with and so failed regardless of whether the
// length guard existed at all. Sized in the low tens of thousands of chars, not hundreds of
// thousands: large enough to exceed STORED_RAW_MAX_LENGTH (20,000), small enough that a mutant
// which widens that constant to 2,000,000 would make THIS SAME payload valid, which is exactly
// what pins the constant's actual value rather than merely "some limit exists".
function oversizedValidWatermarksPayload(): string {
  const entries = Object.fromEntries(Array.from({ length: 1_500 }, (_, index) => [100_000 + index, '20260101000000']))
  const raw = JSON.stringify(entries)
  if (raw.length <= STORED_RAW_MAX_LENGTH) throw new Error('fixture too small to exceed STORED_RAW_MAX_LENGTH')
  if (raw.length >= 2_000_000) throw new Error('fixture too large to distinguish the real limit from a 2,000,000 mutant')
  return raw
}

const watermarkStorage = await import('../src/lib/watermark-store/storage')

// =====================================================================================
// Hydration: lazy on first read, then cached. watermark-store exposes no getSnapshot/
// hasHydrated (unlike follow-store — nothing here reads reactively, see storage.ts's own doc
// comment), so "hydrated and cached" is proven the same way it would be invisible any other
// way: a second read makes no further localStorage call.
// =====================================================================================

assert(watermarkStorage.getWatermark(4549) === null, 'an unhydrated store reads a never-seen pilot as no watermark, not a crash')
{
  const { reads } = itemCallsDuring(() => {
    watermarkStorage.getWatermark(4549)
  })
  assert(reads === 0, 'a second getWatermark() call does not re-read localStorage — the store is genuinely hydrated, not stuck retrying')
}

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

watermarkStorage.recordSeen(4549, '20250101000000') // older candidate — a stale/duplicate write
assertEqual(watermarkStorage.getWatermark(4549), '20260601000000', 'recordSeen never regresses a watermark to an OLDER candidate')

{
  // Not a "MUST-GO-RED for > vs >=" case (a prior version of this file wrongly labelled it
  // that way): an equal candidate produces a byte-identical stored value under EITHER
  // comparison, so this only pins that the value stays correct, not which operator produced
  // it. See watermark-ids.test.ts for the same caveat on the pure function.
  const { writes } = itemCallsDuring(() => {
    watermarkStorage.recordSeen(4549, '20260601000000') // exactly equal — must not error, must not "helpfully" rewrite
  })
  assertEqual(watermarkStorage.getWatermark(4549), '20260601000000', 'recordSeen with a candidate exactly equal to the current value is a no-op, not an error')
  assert(writes === 0, 'recordSeen with a candidate exactly equal to the current value does not write to localStorage')
}

// =====================================================================================
// clearWatermark: the explicit call unfollowing a pilot must make
// =====================================================================================

watermarkStorage.recordSeen(12677, '20260101000000')
assert(watermarkStorage.getWatermark(12677) !== null, 'sanity: pilot 12677 has a recorded watermark before clearing')

watermarkStorage.clearWatermark(12677)
assert(watermarkStorage.getWatermark(12677) === null, 'clearWatermark drops the pilot\'s watermark — a later refollow starts from scratch, not a stale mark')
assertEqual(
  JSON.parse(fakeLocalStorage.raw(WATERMARK_KEY) ?? '{}'),
  { '4549': '20260601000000' },
  'clearWatermark persists the removal to localStorage, leaving other pilots untouched',
)

{
  const beforeNoopClear = fakeLocalStorage.raw(WATERMARK_KEY)
  const { writes } = itemCallsDuring(() => {
    watermarkStorage.clearWatermark(999_999) // never had a watermark
  })
  assertEqual(fakeLocalStorage.raw(WATERMARK_KEY), beforeNoopClear, 'clearWatermark on a pilot with no stored watermark does not write')
  assert(writes === 0, 'clearWatermark on a pilot with no stored watermark makes no localStorage.setItem call')
}

// =====================================================================================
// Cross-tab storage event — same contract as follow-store/storage.ts's handleStorageEvent,
// proven here against getWatermark's return value rather than a subscriber notification count
// (watermark-store has no subscribers to notify — see storage.ts's own doc comment).
// =====================================================================================

fakeLocalStorage.setItem(WATERMARK_KEY, JSON.stringify({ 1: '20260101000000' }))
dispatchStorageEvent(WATERMARK_KEY)
assertEqual(watermarkStorage.getWatermark(1), '20260101000000', 'a storage event for our key re-reads localStorage')

{
  // Writes DIFFERENT content under our key first, THEN dispatches an event for an unrelated
  // key: without this, an unrelated-key event and a no-change event are indistinguishable —
  // removing the `event.key !== null && event.key !== STORAGE_KEY` filter would still show no
  // observable change here, since the re-read (if it happened) would find nothing new either.
  fakeLocalStorage.setItem(WATERMARK_KEY, JSON.stringify({ 1: '20270101000000' }))
  dispatchStorageEvent('some-unrelated-app-key')
  assertEqual(watermarkStorage.getWatermark(1), '20260101000000', 'a storage event for an unrelated key is ignored, even though the stored content actually changed')

  dispatchStorageEvent(WATERMARK_KEY) // now fire the real event, proving the content change above was real and just not yet applied
  assertEqual(watermarkStorage.getWatermark(1), '20270101000000', 'the matching-key event afterward DOES pick up that same change')
}

{
  // Same shape, for key === null (another tab calling localStorage.clear()): writes different
  // content first, so a mutant that drops the `event.key !== null &&` half of the filter and
  // instead treats null as "ignore" (rather than "re-read") is caught, not just a mutant that
  // treats every event as "ignore".
  fakeLocalStorage.setItem(WATERMARK_KEY, JSON.stringify({ 1: '20280101000000' }))
  const { reads } = itemCallsDuring(() => {
    dispatchStorageEvent(null)
  })
  assertEqual(watermarkStorage.getWatermark(1), '20280101000000', 'a storage event with key === null (another tab cleared storage) re-reads and applies the change')
  assert(reads > 0, 'a storage event with key === null actually performs a localStorage read')
}

{
  fakeLocalStorage.setItem(WATERMARK_KEY, 'not json') // another tab somehow wrote a corrupt value
  dispatchStorageEvent(WATERMARK_KEY)
  assertEqual(
    watermarkStorage.getWatermark(1),
    '20280101000000',
    'a storage event carrying a corrupt payload keeps the last GOOD in-memory value, rather than wiping it out',
  )
}

// Re-sync to a clean, known baseline before the boundary-guard sections below, independent of
// whatever the assertions above left behind.
fakeLocalStorage.setItem(WATERMARK_KEY, JSON.stringify({ 4549: '20260601000000', 12677: '20260101000000' }))
dispatchStorageEvent(WATERMARK_KEY)

// =====================================================================================
// Read-side length/shape guards — proven at the storage layer, not just the pure parser: a
// fresh module instance is needed so the corrupt/oversized payload is what FIRST hydration
// reads, exercising ensureHydrated's own handling of a failed read.
// =====================================================================================

interface FreshStore {
  readonly storage: typeof import('../src/lib/watermark-store/storage')
  readonly fakeLocalStorage: FakeLocalStorage
  // Fires the fresh module's OWN `storage` listener directly — a fresh module registers its
  // listener against its own private window/listener set at import time, not the shared
  // `mainWindow`/`storageListeners` above, so the shared `dispatchStorageEvent` cannot reach it.
  readonly dispatchStorageEvent: (key: string | null) => void
}

// Takes the actual test logic as a callback (`withStore`), run INSIDE this function while
// `globalThis.window` still points at the fresh fake — not returned to the caller to use
// afterward. storage.ts reads `window.localStorage` fresh on every call rather than capturing
// a reference at import time, so restoring `window` to `mainWindow` (in `finally`) before the
// caller's own assertions ran would silently make every one of them operate on the SHARED
// fake instead of the fresh one this call seeded — a real bug this file's own history hit:
// early versions returned `{ storage, fakeLocalStorage }` for the caller to use AFTER this
// function returned, by which point `finally` had already restored `window`, so every
// "fresh" interaction after the very first `import()` actually mutated the shared fixture.
async function withFreshStore<T>(
  caseId: string,
  seed: (fake: FakeLocalStorage) => void,
  withStore: (fresh: FreshStore) => Promise<T> | T,
): Promise<T> {
  const fresh = new FakeLocalStorage()
  seed(fresh)
  const freshListeners = new Set<StorageListener>()
  Object.assign(globalThis, { window: makeFakeWindow(fresh, freshListeners) })
  try {
    const storage = await import(`../src/lib/watermark-store/storage?case=${caseId}`)
    return await withStore({
      storage,
      fakeLocalStorage: fresh,
      dispatchStorageEvent: (key) => freshListeners.forEach((listener) => listener({ key })),
    })
  } finally {
    Object.assign(globalThis, { window: mainWindow })
  }
}

// Each fixture's `probePilotId` is the SPECIFIC pilot id that fixture would wrongly end up
// with a watermark for if the guard supposedly rejecting it were removed — not an arbitrary
// shared id. Probing the wrong id would make the assertion below pass "for free" (null either
// way) without the guard actually having fired; see the array fixture in particular, which
// (with Array.isArray(parsed) removed) parses to a real entry for pilot 1 specifically.
for (const [label, corrupt, probePilotId] of [
  ['not json', 'not json', 1],
  ['a JSON array whose entries would otherwise individually validate (pins Array.isArray, not the all-invalid fallback)', '[null,"20260523164423"]', 1],
  ['a payload that is valid in every way except its length (pins STORED_RAW_MAX_LENGTH itself, not just "some" length rejection)', oversizedValidWatermarksPayload(), 100_000],
] as const) {
  let threw = false
  let watermarkAfterHydration: string | null | undefined
  try {
    watermarkAfterHydration = await withFreshStore(
      `corrupt-${label.slice(0, 20).replace(/\s+/g, '-')}`,
      (fake) => fake.setItem(WATERMARK_KEY, corrupt),
      ({ storage }) => storage.getWatermark(probePilotId),
    )
  } catch {
    threw = true
  }
  assert(!threw, `a stored value that is ${label} is rejected without throwing`)
  assertEqual(watermarkAfterHydration, null, `a stored value that is ${label} hydrates to an empty watermark map, not a partially-trusted one`)
}

// =====================================================================================
// Write-side length guard, symmetric with the read-side one: a watermark map that serializes
// past STORED_RAW_MAX_LENGTH must stop being persisted rather than silently overwrite (and
// later re-read as) whatever was last durably stored. Bracketed per-commit exactly like
// check-follow-store.mts's own write-guard loop, for the same reason: sampling only "before"
// and "after" the whole loop can't tell a correct guard from one that clobbers storage on
// every over-limit commit, if every clobber happens to write the same bytes.
// =====================================================================================

await withFreshStore('write-guard', () => {}, ({ storage: freshStorage, fakeLocalStorage: freshFake }) => {
  let writeGuardWarnings = 0
  const originalWarn = console.warn
  console.warn = () => {
    writeGuardWarnings++
  }

  let overLimitCommits = 0
  let overLimitCommitWroteToStorage = false
  let rawWhenGuardFirstTriggered: string | null = null
  // 14-digit timestamps + 6-digit pilot ids serialize predictably (~24 chars/entry including
  // JSON punctuation), so ~1,000 entries comfortably crosses the 20,000-char guard.
  for (const pilotId of Array.from({ length: 1_000 }, (_, index) => 200_000 + index)) {
    const setItemCallsBefore = freshFake.setItemCalls
    const rawBefore = freshFake.raw(WATERMARK_KEY)
    const warningsBefore = writeGuardWarnings
    freshStorage.recordSeen(pilotId, '20260101000000')
    const guardTriggeredForThisCommit = writeGuardWarnings > warningsBefore
    if (!guardTriggeredForThisCommit) continue
    overLimitCommits++
    if (rawWhenGuardFirstTriggered === null) rawWhenGuardFirstTriggered = rawBefore
    if (freshFake.setItemCalls !== setItemCallsBefore || freshFake.raw(WATERMARK_KEY) !== rawBefore) {
      overLimitCommitWroteToStorage = true
    }
  }
  console.warn = originalWarn

  assert(overLimitCommits > 0, 'crossing the write guard warns instead of failing silently')
  assert(
    !overLimitCommitWroteToStorage,
    'no over-limit commit calls localStorage.setItem or changes the persisted raw value, even one that writes bytes matching what a correct guard would have left behind',
  )
  const persistedRaw = freshFake.raw(WATERMARK_KEY)
  assert((persistedRaw?.length ?? 0) <= STORED_RAW_MAX_LENGTH, 'localStorage never receives a payload past the length guard')
  assert(persistedRaw === rawWhenGuardFirstTriggered, 'crossing the write guard leaves the previously persisted raw value byte-for-byte untouched, not overwritten')
  assert(
    freshStorage.getWatermark(200_000) === '20260101000000',
    'the in-memory value for this tab still advances for every pilot, even ones that stopped being persisted',
  )
})

// =====================================================================================
// Resilience: a throwing localStorage must not crash the store, and must not wipe the
// in-memory value either.
// =====================================================================================

await withFreshStore(
  'throwing',
  (fake) => fake.setItem(WATERMARK_KEY, JSON.stringify({ 21: '20260101000000' })),
  ({ storage: freshStorage, fakeLocalStorage: freshFake, dispatchStorageEvent: dispatchFreshStorageEvent }) => {
    assertEqual(freshStorage.getWatermark(21), '20260101000000', 'resilience baseline: pilot 21 has a watermark before the throwing storage event')

    freshFake.setThrowing(true)
    dispatchFreshStorageEvent(WATERMARK_KEY)
    assertEqual(freshStorage.getWatermark(21), '20260101000000', 'a throwing localStorage.getItem during a storage event leaves the in-memory value untouched instead of wiping it')

    freshStorage.recordSeen(22, '20260101000000')
    assertEqual(freshStorage.getWatermark(22), '20260101000000', 'a throwing localStorage.setItem still updates the in-memory value for this tab')
    freshFake.setThrowing(false)
  },
)

// =====================================================================================
// Cross-store integration: unfollowing must drop the pilot's watermark. The follow list itself
// moved server-side in #115 (supabase/migrations/20260810020000_create_follows.sql); this
// watermark clear is the one piece of the old unfollow sequence that stayed client-side (the
// watermark is still localStorage-backed, unrelated to #115's own scope), now composed directly
// in the FollowButton component's own click handler (src/components/follow-button/index.tsx,
// AFTER a confirmed unfollow — see its own doc comment) rather than inside a shared
// useFollowPilot toggle. This proves the watermark half of that sequence leaves the system in
// the right state, without needing a DOM (src/components/follow-button/index.test.tsx separately
// proves the component itself triggers this call, and only after a confirmed unfollow).
// =====================================================================================

{
  const PILOT = 55_555

  watermarkStorage.recordSeen(PILOT, '20260101000000')
  assert(watermarkStorage.getWatermark(PILOT) !== null, 'sanity: pilot has a recorded watermark before unfollowing')

  // The call FollowButton's click handler makes once the unfollow Server Action confirms success.
  watermarkStorage.clearWatermark(PILOT)

  assert(
    watermarkStorage.getWatermark(PILOT) === null,
    'unfollow sequence: the watermark is dropped — refollowing this pilot later will show their whole history as new again, not silently skip it',
  )
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
