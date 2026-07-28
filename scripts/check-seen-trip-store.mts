// Mirrors scripts/check-watermark-store.mts's shape (see its own doc comments for the full
// rationale): seen-trip-store/storage.ts is gated on `typeof window` and reads/writes
// `window.localStorage` directly, so exercising it under plain node means faking just enough
// of `window` before the module is first imported (it registers a `storage` listener at
// module-eval time).
//
// Deliberately does NOT re-derive watermark-store's own coverage from scratch: it duplicates
// code SHAPE (hydrate-on-first-read, commit-if-changed, cross-tab listener) with watermark-
// store, which itself duplicates the shape follow-store established — but that shape being
// proven correct once, generically, at either of those stores does not carry over here;
// coverage binds to a module instance, not a pattern. This file does NOT extract a shared store
// primitive across the three (a prior version of this comment cited an eviction-policy
// divergence to justify that — measured line-identity actually showed this store's adapter
// MORE similar to watermark-store's than watermark-store's is to follow-store's, so that was
// not the real reason). The real reason is smaller in scope: both reviews for this fix round
// agreed extraction is not a merge blocker and the change would be large, so it is left for a
// later, dedicated pass — not because these adapters have nothing in common, but because
// nothing about this fix round depends on making that call. pruneSeenTripIdsToFollowedPilots
// (see storage.ts) is a genuine, new piece of this store's own adapter that watermark-store's
// does not have, added in this same round — a real point of divergence, unlike the fabricated
// one this comment used to cite. Every guarantee this file's own production code claims (the
// read/write length guards, the cross-tab key filter, the null-key case, the bounded-replace
// invariant, clearSeenTripIds, pruneSeenTripIdsToFollowedPilots, and the cross-store unfollow
// integration) is proven again here, against THIS module, with its own mutation-tested
// fixtures.

import { STORED_RAW_MAX_LENGTH } from '../src/lib/seen-trip-store/seen-trip-ids'

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
  // Counts real reads/writes, not just whatever the module's own cache says — see
  // check-watermark-store.mts's identical fields for the full rationale.
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

const SEEN_TRIP_KEY = 'flight-log:seen-untracked-trips'

function itemCallsDuring(action: () => void): { reads: number; writes: number } {
  const readsBefore = fakeLocalStorage.getItemCalls
  const writesBefore = fakeLocalStorage.setItemCalls
  action()
  return { reads: fakeLocalStorage.getItemCalls - readsBefore, writes: fakeLocalStorage.setItemCalls - writesBefore }
}

// A payload that is REJECTED ONLY because of its length: every entry is a real pilot id mapped
// to a real single-element array of a valid trip id, so this can only fail via the length
// guard, never via the per-entry validation path. Sized in the low tens of thousands of
// chars, small enough that a mutant which widens STORED_RAW_MAX_LENGTH to 2,000,000 would
// make THIS SAME payload valid, which is exactly what pins the constant's actual value rather
// than merely "some limit exists".
//
// Records a FAILURE via `assert`, rather than throwing, if the fixture's own size assumptions
// stop holding (e.g. STORED_RAW_MAX_LENGTH raised well past what 1,700 entries produce): a
// throw here happens at module-eval time, before any of this file's other checks get a chance
// to run, degrading the whole script's output to an uncaught stack trace with no PASS/FAIL
// summary at all — worse than a normal failing assertion, not more informative than one.
function oversizedValidSeenTripsPayload(): string {
  const entries = Object.fromEntries(Array.from({ length: 1_700 }, (_, index) => [100_000 + index, [1]]))
  const raw = JSON.stringify(entries)
  assert(
    raw.length > STORED_RAW_MAX_LENGTH,
    'fixture: oversizedValidSeenTripsPayload exceeds STORED_RAW_MAX_LENGTH (bumping the limit requires bumping this fixture\'s entry count too)',
  )
  assert(
    raw.length < 2_000_000,
    'fixture: oversizedValidSeenTripsPayload stays under 2,000,000 chars, so it still pins the real limit rather than a hugely inflated mutant',
  )
  return raw
}

const seenTripStorage = await import('../src/lib/seen-trip-store/storage')

// =====================================================================================
// Hydration: lazy on first read, then cached — same shape as watermark-store, same reason
// (no getSnapshot/subscribe surface: nothing here is read reactively).
// =====================================================================================

assert(seenTripStorage.getSeenTripIds(4549) === null, 'an unhydrated store reads a never-seen pilot as no entry, not a crash')
{
  const { reads } = itemCallsDuring(() => {
    seenTripStorage.getSeenTripIds(4549)
  })
  assert(reads === 0, 'a second getSeenTripIds() call does not re-read localStorage — the store is genuinely hydrated, not stuck retrying')
}

// =====================================================================================
// recordSeenTripIds: the only write path, implementing replaceSeenTripIds's bounded-replace
// rule (neither pure replace nor pure union — see seen-trip-ids.ts's own doc comment).
// =====================================================================================

seenTripStorage.recordSeenTripIds(4549, { fetchedTripIds: new Set([100, 200]), renderedTripIds: new Set([100]) })
assertEqual([...(seenTripStorage.getSeenTripIds(4549) ?? [])], [100], 'recordSeenTripIds sets an initial entry from what rendered this load')
assertEqual(
  JSON.parse(fakeLocalStorage.raw(SEEN_TRIP_KEY) ?? '{}'),
  { '4549': [100] },
  'recordSeenTripIds persists the entry to localStorage',
)

// A previously-remembered id (100) still within this load's fetched scope but NOT rendered
// this time survives; a newly-rendered id (200) is added; the fetched scope itself is
// bounded, so this can only ever grow up to `fetchedTripIds.size`.
seenTripStorage.recordSeenTripIds(4549, { fetchedTripIds: new Set([100, 200, 300]), renderedTripIds: new Set([200]) })
assertEqual(
  [...(seenTripStorage.getSeenTripIds(4549) ?? [])].sort(),
  [100, 200],
  'recordSeenTripIds preserves a previously-seen id that is still in scope but not rendered THIS load, alongside what rendered this load',
)

// Now 100 falls OUT of the fetched scope entirely (no longer among this pilot's recent
// flights) — it must be pruned, not carried forward forever the way a pure union would.
seenTripStorage.recordSeenTripIds(4549, { fetchedTripIds: new Set([200, 300]), renderedTripIds: new Set([300]) })
assertEqual(
  [...(seenTripStorage.getSeenTripIds(4549) ?? [])].sort(),
  [200, 300],
  'recordSeenTripIds drops an id that has aged out of the fetched scope, rather than keeping it forever',
)

// =====================================================================================
// clearSeenTripIds: the explicit call unfollowing a pilot must make
// =====================================================================================

seenTripStorage.recordSeenTripIds(12677, { fetchedTripIds: new Set([1]), renderedTripIds: new Set([1]) })
assert(seenTripStorage.getSeenTripIds(12677) !== null, 'sanity: pilot 12677 has a recorded entry before clearing')

seenTripStorage.clearSeenTripIds(12677)
assert(seenTripStorage.getSeenTripIds(12677) === null, 'clearSeenTripIds drops the pilot\'s entry — a later refollow starts from scratch, not a stale mark')
assertEqual(
  JSON.parse(fakeLocalStorage.raw(SEEN_TRIP_KEY) ?? '{}'),
  { '4549': [200, 300] },
  'clearSeenTripIds persists the removal to localStorage, leaving other pilots untouched',
)

{
  const beforeNoopClear = fakeLocalStorage.raw(SEEN_TRIP_KEY)
  const { writes } = itemCallsDuring(() => {
    seenTripStorage.clearSeenTripIds(999_999) // never had an entry
  })
  assertEqual(fakeLocalStorage.raw(SEEN_TRIP_KEY), beforeNoopClear, 'clearSeenTripIds on a pilot with no stored entry does not write')
  assert(writes === 0, 'clearSeenTripIds on a pilot with no stored entry makes no localStorage.setItem call')
}

// =====================================================================================
// Cross-tab storage event — same contract as watermark-store's handleStorageEvent, proven
// here against getSeenTripIds's return value.
// =====================================================================================

fakeLocalStorage.setItem(SEEN_TRIP_KEY, JSON.stringify({ 1: [500] }))
dispatchStorageEvent(SEEN_TRIP_KEY)
assertEqual([...(seenTripStorage.getSeenTripIds(1) ?? [])], [500], 'a storage event for our key re-reads localStorage')

{
  fakeLocalStorage.setItem(SEEN_TRIP_KEY, JSON.stringify({ 1: [600] }))
  dispatchStorageEvent('some-unrelated-app-key')
  assertEqual([...(seenTripStorage.getSeenTripIds(1) ?? [])], [500], 'a storage event for an unrelated key is ignored, even though the stored content actually changed')

  dispatchStorageEvent(SEEN_TRIP_KEY)
  assertEqual([...(seenTripStorage.getSeenTripIds(1) ?? [])], [600], 'the matching-key event afterward DOES pick up that same change')
}

{
  fakeLocalStorage.setItem(SEEN_TRIP_KEY, JSON.stringify({ 1: [700] }))
  const { reads } = itemCallsDuring(() => {
    dispatchStorageEvent(null)
  })
  assertEqual([...(seenTripStorage.getSeenTripIds(1) ?? [])], [700], 'a storage event with key === null (another tab cleared storage) re-reads and applies the change')
  assert(reads > 0, 'a storage event with key === null actually performs a localStorage read')
}

{
  fakeLocalStorage.setItem(SEEN_TRIP_KEY, 'not json') // another tab somehow wrote a corrupt value
  dispatchStorageEvent(SEEN_TRIP_KEY)
  assertEqual(
    [...(seenTripStorage.getSeenTripIds(1) ?? [])],
    [700],
    'a storage event carrying a corrupt payload keeps the last GOOD in-memory value, rather than wiping it out',
  )
}

// Re-sync to a clean, known baseline before the boundary-guard sections below.
fakeLocalStorage.setItem(SEEN_TRIP_KEY, JSON.stringify({ 4549: [200, 300], 12677: [1] }))
dispatchStorageEvent(SEEN_TRIP_KEY)

// =====================================================================================
// pruneSeenTripIdsToFollowedPilots: the fix for storage.ts's own writeSeenTrips doc comment
// (a prior version of it falsely claimed this map's pilot count was bounded by
// MAX_PILOTS_PER_FEED — it is not; only ONE LOAD's fetch is bounded that way, and a pilot who
// stays followed but stops making selectFeedPilotIds's lowest-MAX_PILOTS_PER_FEED cut kept
// their entry forever without this).
// =====================================================================================

{
  seenTripStorage.pruneSeenTripIdsToFollowedPilots(new Set([4549])) // 12677 is NOT in this set
  assertEqual(
    [...(seenTripStorage.getSeenTripIds(4549) ?? [])].sort(),
    [200, 300],
    'pruneSeenTripIdsToFollowedPilots leaves a pilot present in the followed set completely untouched',
  )
  assert(
    seenTripStorage.getSeenTripIds(12677) === null,
    'pruneSeenTripIdsToFollowedPilots drops a pilot ABSENT from the followed set — this is the eviction path storage.ts\'s own doc comment describes: a still-followed pilot who simply stopped making the top-MAX_PILOTS_PER_FEED selection has no OTHER way to leave this map',
  )
  assertEqual(
    JSON.parse(fakeLocalStorage.raw(SEEN_TRIP_KEY) ?? '{}'),
    { '4549': [200, 300] },
    'pruneSeenTripIdsToFollowedPilots persists the eviction to localStorage',
  )
}

{
  const beforeNoopPrune = fakeLocalStorage.raw(SEEN_TRIP_KEY)
  const { writes } = itemCallsDuring(() => {
    seenTripStorage.pruneSeenTripIdsToFollowedPilots(new Set([4549])) // already exactly the followed set
  })
  assertEqual(fakeLocalStorage.raw(SEEN_TRIP_KEY), beforeNoopPrune, 'pruneSeenTripIdsToFollowedPilots is a no-op when every stored pilot is already in the followed set')
  assert(writes === 0, 'a no-op prune makes no localStorage.setItem call')
}

// Restore the pre-prune baseline the read-side guard sections below assume.
fakeLocalStorage.setItem(SEEN_TRIP_KEY, JSON.stringify({ 4549: [200, 300], 12677: [1] }))
dispatchStorageEvent(SEEN_TRIP_KEY)

// =====================================================================================
// Read-side length/shape guards — proven at the storage layer, not just the pure parser: a
// fresh module instance is needed so the corrupt/oversized payload is what FIRST hydration
// reads, exercising ensureHydrated's own handling of a failed read.
// =====================================================================================

interface FreshStore {
  readonly storage: typeof import('../src/lib/seen-trip-store/storage')
  readonly fakeLocalStorage: FakeLocalStorage
  readonly dispatchStorageEvent: (key: string | null) => void
}

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
    const storage = await import(`../src/lib/seen-trip-store/storage?case=${caseId}`)
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
// with an entry for if the guard supposedly rejecting it were removed.
for (const [label, corrupt, probePilotId] of [
  ['not json', 'not json', 1],
  ['a JSON array whose entries would otherwise individually validate (pins Array.isArray, not the all-invalid fallback)', '[[1],[2]]', 1],
  ['a payload that is valid in every way except its length (pins STORED_RAW_MAX_LENGTH itself, not just "some" length rejection)', oversizedValidSeenTripsPayload(), 100_000],
] as const) {
  let threw = false
  let entryAfterHydration: ReadonlySet<number> | null | undefined
  try {
    entryAfterHydration = await withFreshStore(
      `corrupt-${label.slice(0, 20).replace(/\s+/g, '-')}`,
      (fake) => fake.setItem(SEEN_TRIP_KEY, corrupt),
      ({ storage }) => storage.getSeenTripIds(probePilotId),
    )
  } catch {
    threw = true
  }
  assert(!threw, `a stored value that is ${label} is rejected without throwing`)
  assertEqual(entryAfterHydration, null, `a stored value that is ${label} hydrates to no entries, not a partially-trusted one`)
}

// =====================================================================================
// Write-side length guard, symmetric with the read-side one: bracketed per-commit exactly
// like check-watermark-store.mts's own write-guard loop, for the same reason (sampling only
// "before" and "after" the whole loop can't tell a correct guard from one that clobbers
// storage on every over-limit commit, if every clobber happens to write the same bytes).
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
  // Each pilot gets its own single-element fetched/rendered set, so every commit is a
  // genuinely NEW pilot entry (never a no-op re-commit of the same content) — 1,600 pilots
  // (a 6-digit id plus a single-element array serializes to ~13 chars/entry) comfortably
  // crosses the 20,000-char guard.
  for (const pilotId of Array.from({ length: 1_600 }, (_, index) => 200_000 + index)) {
    const setItemCallsBefore = freshFake.setItemCalls
    const rawBefore = freshFake.raw(SEEN_TRIP_KEY)
    const warningsBefore = writeGuardWarnings
    freshStorage.recordSeenTripIds(pilotId, { fetchedTripIds: new Set([1]), renderedTripIds: new Set([1]) })
    const guardTriggeredForThisCommit = writeGuardWarnings > warningsBefore
    if (!guardTriggeredForThisCommit) continue
    overLimitCommits++
    if (rawWhenGuardFirstTriggered === null) rawWhenGuardFirstTriggered = rawBefore
    if (freshFake.setItemCalls !== setItemCallsBefore || freshFake.raw(SEEN_TRIP_KEY) !== rawBefore) {
      overLimitCommitWroteToStorage = true
    }
  }
  console.warn = originalWarn

  assert(overLimitCommits > 0, 'crossing the write guard warns instead of failing silently')
  assert(
    !overLimitCommitWroteToStorage,
    'no over-limit commit calls localStorage.setItem or changes the persisted raw value, even one that writes bytes matching what a correct guard would have left behind',
  )
  const persistedRaw = freshFake.raw(SEEN_TRIP_KEY)
  assert((persistedRaw?.length ?? 0) <= STORED_RAW_MAX_LENGTH, 'localStorage never receives a payload past the length guard')
  assert(persistedRaw === rawWhenGuardFirstTriggered, 'crossing the write guard leaves the previously persisted raw value byte-for-byte untouched, not overwritten')
  assert(
    [...(freshStorage.getSeenTripIds(200_000) ?? [])].includes(1),
    'the in-memory value for this tab still updates for every pilot, even ones that stopped being persisted',
  )
})

// =====================================================================================
// Resilience: a throwing localStorage must not crash the store, and must not wipe the
// in-memory value either.
// =====================================================================================

await withFreshStore(
  'throwing',
  (fake) => fake.setItem(SEEN_TRIP_KEY, JSON.stringify({ 21: [1] })),
  ({ storage: freshStorage, fakeLocalStorage: freshFake, dispatchStorageEvent: dispatchFreshStorageEvent }) => {
    assertEqual([...(freshStorage.getSeenTripIds(21) ?? [])], [1], 'resilience baseline: pilot 21 has an entry before the throwing storage event')

    freshFake.setThrowing(true)
    dispatchFreshStorageEvent(SEEN_TRIP_KEY)
    assertEqual([...(freshStorage.getSeenTripIds(21) ?? [])], [1], 'a throwing localStorage.getItem during a storage event leaves the in-memory value untouched instead of wiping it')

    freshStorage.recordSeenTripIds(22, { fetchedTripIds: new Set([2]), renderedTripIds: new Set([2]) })
    assertEqual([...(freshStorage.getSeenTripIds(22) ?? [])], [2], 'a throwing localStorage.setItem still updates the in-memory value for this tab')
    freshFake.setThrowing(false)
  },
)

// =====================================================================================
// Cross-store integration: unfollowing must drop the pilot's seen-trip entry. FollowButton's
// own click handler is composed in useFollowPilot (src/lib/follow-store/use-follow-store.ts)
// — it calls clearWatermark(pilotId) AND clearSeenTripIds(pilotId), THEN toggles follow-store.
// This proves the underlying sequence a click performs actually leaves the system in the
// right state, without needing a DOM.
// =====================================================================================

{
  const followStorage = await import('../src/lib/follow-store/storage')
  const watermarkStorage = await import('../src/lib/watermark-store/storage')
  const PILOT = 55_555

  followStorage.follow(PILOT)
  watermarkStorage.recordSeen(PILOT, '20260101000000')
  seenTripStorage.recordSeenTripIds(PILOT, { fetchedTripIds: new Set([1]), renderedTripIds: new Set([1]) })
  assert(followStorage.getSnapshot().followedIds.has(PILOT), 'sanity: pilot is followed before unfollowing')
  assert(seenTripStorage.getSeenTripIds(PILOT) !== null, 'sanity: pilot has a recorded seen-trip entry before unfollowing')

  // The exact sequence useFollowPilot's toggle performs when isFollowed is true.
  watermarkStorage.clearWatermark(PILOT)
  seenTripStorage.clearSeenTripIds(PILOT)
  followStorage.unfollow(PILOT)

  assert(!followStorage.getSnapshot().followedIds.has(PILOT), 'unfollow sequence: the pilot is no longer followed')
  assert(
    seenTripStorage.getSeenTripIds(PILOT) === null,
    'unfollow sequence: the seen-trip entry is dropped — refollowing this pilot later will show their whole untracked history as new again, not silently skip it',
  )
}

// =====================================================================================
// Measured worst case: MAX_PILOTS_PER_FEED (20) pilots, each at the RECENT_FLIGHTS_PER_PILOT
// (30) bound, serialized — proof the design's own stated budget actually holds, not just
// asserted in a comment. See feed.ts for both constants.
// =====================================================================================

{
  const { serializeSeenTrips } = await import('../src/lib/seen-trip-store/seen-trip-ids')
  const MAX_PILOTS_PER_FEED = 20
  const RECENT_FLIGHTS_PER_PILOT = 30
  const worstCase = new Map<number, ReadonlySet<number>>(
    Array.from({ length: MAX_PILOTS_PER_FEED }, (_, pilotIndex) => [
      100_000 + pilotIndex,
      new Set(Array.from({ length: RECENT_FLIGHTS_PER_PILOT }, (_, tripIndex) => 900_000_000 + pilotIndex * 1_000 + tripIndex)),
    ]),
  )
  const serialized = serializeSeenTrips(worstCase)
  console.log(`  measured: ${MAX_PILOTS_PER_FEED} pilots × ${RECENT_FLIGHTS_PER_PILOT} ids serializes to ${serialized.length} chars (limit ${STORED_RAW_MAX_LENGTH})`)
  assert(
    serialized.length < STORED_RAW_MAX_LENGTH,
    `the worst case the feed can ever produce (${MAX_PILOTS_PER_FEED} pilots × ${RECENT_FLIGHTS_PER_PILOT} ids) serializes under STORED_RAW_MAX_LENGTH, with room to spare`,
  )
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
