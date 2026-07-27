import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isDeepStrictEqual, inspect } from 'node:util'
import {
  buildFeedEntries,
  failedPilotResults,
  FEED_SIZE,
  loadRecentFlightsForPilot,
  MAX_PILOTS_PER_FEED,
  MAX_YEARS_PER_PILOT,
  RECENT_FLIGHTS_PER_PILOT,
  selectFeedPilotIds,
  sliceRecentFlights,
  type PilotFeedFailure,
  type PilotFeedResult,
  type PilotFeedSuccess,
} from '../src/features/browse-flight-feed/feed'
import { CONCURRENCY_LIMIT } from '../src/features/browse-flight-feed/use-flight-feed'
import { fetchPilotFeed } from '../src/features/browse-flight-feed/fetch-pilot-feed'
import { FeedView, FlightFeedView } from '../src/features/browse-flight-feed'
import { runWithConcurrencyLimit, type Settled } from '../src/lib/concurrency/with-limit'
import type { Flight, Pilot } from '../src/lib/flightlog/types'

let failures = 0

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

// Deep, type-aware equality (not JSON.stringify, which collapses NaN/undefined/Infinity to
// the same "null"-ish text and can't distinguish a missing key from an explicit undefined) —
// this is what actually makes assertEqual able to fail on the shapes this file checks
// (Settled outcomes, Sets, objects with optional fields).
function assertEqual<T>(actual: T, expected: T, label: string): void {
  const pass = isDeepStrictEqual(actual, expected)
  console.log(`${pass ? 'ok' : 'FAIL'} - ${label}`)
  if (!pass) {
    failures++
    console.error(`  expected: ${inspect(expected)}`)
    console.error(`  actual:   ${inspect(actual)}`)
  }
}

// --- Fixtures ---

let nextTripId = 1
function makeFlight(overrides: Partial<Flight> & { date: string }): Flight {
  return {
    tripId: nextTripId++,
    userId: 1,
    country: null,
    takeoff: null,
    glider: null,
    duration: '1:00',
    flightCount: 1,
    distanceKm: 10,
    openDistanceKm: null,
    note: null,
    ...overrides,
  }
}

function makePilot(overrides: Partial<Pilot> & { userId: number }): Pilot {
  return { name: `Pilot ${overrides.userId}`, country: null, club: null, ...overrides }
}

function success(overrides: Partial<PilotFeedSuccess> & { pilotId: number }): PilotFeedSuccess {
  return {
    status: 'success',
    pilot: makePilot({ userId: overrides.pilotId }),
    flights: [],
    trackedTripIds: [],
    ...overrides,
  }
}

function failure(pilotId: number, message = 'boom'): PilotFeedFailure {
  return { status: 'error', pilotId, message }
}

// =====================================================================================
// Production budgets: pinned to a hardcoded expected value, not just imported and echoed
// back at themselves — an assertion that only checks a constant equals itself can never
// fail no matter what the constant is set to.
// =====================================================================================

assertEqual(FEED_SIZE, 30, 'FEED_SIZE is pinned to 30 (the reviewed traffic-safety budget)')
assertEqual(RECENT_FLIGHTS_PER_PILOT, 30, 'RECENT_FLIGHTS_PER_PILOT is pinned to 30')
assertEqual(
  MAX_YEARS_PER_PILOT,
  2,
  'MAX_YEARS_PER_PILOT is pinned to 2 — the explicit per-pilot traffic bound this branch was rejected for lacking',
)
assertEqual(MAX_PILOTS_PER_FEED, 20, 'MAX_PILOTS_PER_FEED is pinned to 20')
assertEqual(CONCURRENCY_LIMIT, 4, 'CONCURRENCY_LIMIT is pinned to 4')

// The restated worst case: a 10-pilot feed costs one getPilotLogbook request plus at most
// MAX_YEARS_PER_PILOT track-index requests PER PILOT, regardless of how many years that
// pilot has actually flown — this is the number the B1 finding said was 200 pre-fix.
{
  const tenPilotWorstCase = 10 * (1 + MAX_YEARS_PER_PILOT)
  assertEqual(
    tenPilotWorstCase,
    30,
    'worst case flightlog.org requests for a 10-pilot feed is pinned at 30 (10 × (1 pilot-page + MAX_YEARS_PER_PILOT track-year requests))',
  )
  assert(
    tenPilotWorstCase < 200,
    'the 10-pilot worst case (30 requests) stays far under the ~200-request burst that silently killed a session (docs/flightlog-api.md)',
  )

  const fullCapWorstCase = MAX_PILOTS_PER_FEED * (1 + MAX_YEARS_PER_PILOT)
  assertEqual(fullCapWorstCase, 60, 'worst case requests at the full MAX_PILOTS_PER_FEED cap is pinned at 60')
  assert(fullCapWorstCase < 200, 'the full-cap worst case (60 requests) also stays under the 200-request session-killing threshold')
}

// =====================================================================================
// sliceRecentFlights: the per-pilot recent slice, and the traffic-safety year derivation
// =====================================================================================

// An 18-year history, one flight per year, sliced to an explicit 3: the flight slice keeps
// 3 flights, but the YEAR set is capped to MAX_YEARS_PER_PILOT regardless — the flight-count
// slice alone does not bound the year count, which is exactly what made the pre-fix version
// of this function only "usually" traffic-safe.
{
  nextTripId = 1
  const eighteenYearHistory = Array.from({ length: 18 }, (_, index) =>
    makeFlight({ date: `${2008 + index}-06-15` }),
  )
  const slice = sliceRecentFlights(eighteenYearHistory, 3)
  assertEqual(
    slice.flights.map((f) => f.date),
    ['2025-06-15', '2024-06-15', '2023-06-15'],
    'sliceRecentFlights: an 18-year history sliced to 3 keeps the 3 most recent flights, newest first',
  )
  assertEqual(
    slice.years,
    [2025, 2024],
    'sliceRecentFlights: years are capped to MAX_YEARS_PER_PILOT (2), even though the 3-flight slice itself spans 3 years',
  )
}

// The unmissable one, at PRODUCTION default arity: an infrequent pilot (one flight a year)
// whose RECENT_FLIGHTS_PER_PILOT-flight slice spans far more than "one or two" years on its
// own — this is the exact scenario the B1 review used (a pilot flying once a year since
// 2008). Called with NO explicit limit argument, so a regression that hardcodes either
// function's default parameter independently of the imported constants still gets caught.
{
  nextTripId = 1
  const infrequentPilotHistory = Array.from({ length: 40 }, (_, index) =>
    makeFlight({ date: `${1986 + index}-06-15` }),
  )
  const slice = sliceRecentFlights(infrequentPilotHistory)
  assertEqual(
    slice.flights.length,
    RECENT_FLIGHTS_PER_PILOT,
    'sliceRecentFlights at default arity: a 40-year, one-flight-a-year history still slices to exactly RECENT_FLIGHTS_PER_PILOT flights',
  )
  assertEqual(
    slice.years.length,
    MAX_YEARS_PER_PILOT,
    'sliceRecentFlights at default arity: an infrequent pilot whose recent slice spans many years still resolves only MAX_YEARS_PER_PILOT of them',
  )
  assertEqual(
    slice.years,
    [2025, 2024],
    'sliceRecentFlights at default arity: the years kept are the MOST RECENT ones, not an arbitrary pair',
  )
}

// A direct, isolated pin on the year-derivation half of the property: several flights
// within the same year dedupe to one entry, and years appear in the slice's own newest-
// first order — a hardcoded or unordered result would still fail this exact shape.
{
  nextTripId = 1
  const flights = [
    makeFlight({ date: '2026-03-01' }),
    makeFlight({ date: '2026-01-10' }),
    makeFlight({ date: '2024-07-04' }),
  ]
  const slice = sliceRecentFlights(flights, 10)
  assertEqual(
    slice.years,
    [2026, 2024],
    'sliceRecentFlights: duplicate years within the slice dedupe to one entry each',
  )
}

// Ties on date: same-day flights order by tripId descending, a stable tiebreak — proven
// by constructing two flights on the same date with tripIds assigned out of creation order.
{
  const older = makeFlight({ date: '2026-05-01' }) // gets the lower tripId
  const newer = makeFlight({ date: '2026-05-01' }) // gets the higher tripId
  const slice = sliceRecentFlights([older, newer], 10)
  assertEqual(
    slice.flights.map((f) => f.tripId),
    [newer.tripId, older.tripId],
    'sliceRecentFlights: flights tied on date order by tripId descending (stable tiebreak)',
  )
}

// A pilot with no flights at all: neither the slice nor the year derivation should throw
// or fabricate anything.
assertEqual(
  sliceRecentFlights([], 10),
  { flights: [], years: [] },
  'sliceRecentFlights: a pilot with no flights slices to an empty flight list and no years',
)

// The slice bound itself: more flights than the limit must be truncated, not merely sorted.
{
  nextTripId = 1
  const manyFlights = Array.from({ length: 5 }, (_, index) => makeFlight({ date: `2026-01-0${index + 1}` }))
  const slice = sliceRecentFlights(manyFlights, 2)
  assert(slice.flights.length === 2, 'sliceRecentFlights: the returned slice is truncated to the requested limit')
}

// =====================================================================================
// loadRecentFlightsForPilot: the route handler's own orchestration, tested here with a
// stubbed resolveTrackedTripIds so the wiring itself — not just sliceRecentFlights in
// isolation — is proven to pass the SLICE's years, never the full history's.
// =====================================================================================

{
  nextTripId = 1
  const manyYearHistory = Array.from({ length: 40 }, (_, index) => makeFlight({ date: `${1986 + index}-06-15` }))
  const pilot = makePilot({ userId: 77 })
  let calledWithPilotId: number | undefined
  let calledWithYears: number[] = []
  const stubResolveTrackedTripIds = async (pilotId: number, years: number[]): Promise<Set<number>> => {
    calledWithPilotId = pilotId
    calledWithYears = years
    return new Set()
  }

  const body = await loadRecentFlightsForPilot(77, { pilot, flights: manyYearHistory }, stubResolveTrackedTripIds)

  assertEqual(calledWithPilotId, 77, 'loadRecentFlightsForPilot: resolves tracks for the pilot it was asked about')
  assertEqual(
    calledWithYears,
    [2025, 2024],
    'loadRecentFlightsForPilot: resolves tracks using years derived from the RECENT SLICE, never the full 40-year history — this is the exact wiring bug (deriving years from full history) that made the pre-fix route only sometimes traffic-safe',
  )
  assertEqual(body.flights.length, RECENT_FLIGHTS_PER_PILOT, 'loadRecentFlightsForPilot: the returned flights are the sliced recent flights')
}

// =====================================================================================
// buildFeedEntries: merging, sorting, and slicing recent flights ACROSS pilots
// =====================================================================================

// Merge + sort newest-first across two pilots whose own flights interleave by date.
{
  nextTripId = 100
  const alice = makePilot({ userId: 1, name: 'Alice' })
  const bob = makePilot({ userId: 2, name: 'Bob' })
  const aliceFlight1 = makeFlight({ userId: 1, date: '2026-01-10' })
  const aliceFlight2 = makeFlight({ userId: 1, date: '2026-01-20' })
  const bobFlight1 = makeFlight({ userId: 2, date: '2026-01-15' })

  const results: PilotFeedResult[] = [
    success({ pilotId: 1, pilot: alice, flights: [aliceFlight1, aliceFlight2] }),
    success({ pilotId: 2, pilot: bob, flights: [bobFlight1] }),
  ]

  const entries = buildFeedEntries(results, 10)
  assertEqual(
    entries.map((e) => [e.pilot.name, e.flight.date]),
    [
      ['Alice', '2026-01-20'],
      ['Bob', '2026-01-15'],
      ['Alice', '2026-01-10'],
    ],
    'buildFeedEntries: flights from several pilots merge into one newest-first list, interleaved correctly',
  )
}

// Ties on date across DIFFERENT pilots: still resolved by the same stable tripId tiebreak,
// independent of which pilot the flight belongs to or the order results were passed in.
{
  const pilotA = makePilot({ userId: 10 })
  const pilotB = makePilot({ userId: 20 })
  const earlierTrip = makeFlight({ userId: 10, date: '2026-02-02' })
  const laterTrip = makeFlight({ userId: 20, date: '2026-02-02' })
  const results: PilotFeedResult[] = [
    success({ pilotId: 10, pilot: pilotA, flights: [earlierTrip] }),
    success({ pilotId: 20, pilot: pilotB, flights: [laterTrip] }),
  ]
  const entries = buildFeedEntries(results, 10)
  assertEqual(
    entries.map((e) => e.flight.tripId),
    [laterTrip.tripId, earlierTrip.tripId],
    'buildFeedEntries: cross-pilot ties on date order by tripId descending, same rule as within one pilot',
  )
}

// The slice bound on the MERGED feed: more entries across pilots than the limit must be
// truncated after merging, not per pilot.
{
  nextTripId = 200
  const pilot = makePilot({ userId: 3 })
  const flights = Array.from({ length: 6 }, (_, index) => makeFlight({ userId: 3, date: `2026-04-0${index + 1}` }))
  const entries = buildFeedEntries([success({ pilotId: 3, pilot, flights })], 3)
  assert(entries.length === 3, 'buildFeedEntries: the merged feed is truncated to the requested limit')
  assertEqual(
    entries.map((e) => e.flight.date),
    ['2026-04-06', '2026-04-05', '2026-04-04'],
    'buildFeedEntries: the truncated merged feed keeps the newest entries, not an arbitrary subset',
  )
}

// buildFeedEntries at PRODUCTION default arity: a single pilot supplying more flights than
// FEED_SIZE must still truncate to exactly FEED_SIZE, without an explicit limit argument —
// catches a regression that hardcodes the function's own default independently of FEED_SIZE.
{
  nextTripId = 500
  const pilot = makePilot({ userId: 50 })
  const manyFlights = Array.from({ length: 40 }, (_, index) => {
    const month = Math.floor(index / 28) + 1
    const day = (index % 28) + 1
    return makeFlight({ userId: 50, date: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` })
  })
  const entries = buildFeedEntries([success({ pilotId: 50, pilot, flights: manyFlights })])
  assertEqual(entries.length, FEED_SIZE, 'buildFeedEntries at default arity: more entries than FEED_SIZE still truncates to exactly FEED_SIZE')
}

// hasTrack is derived per entry from that pilot's own trackedTripIds, not shared/guessed.
{
  const pilot = makePilot({ userId: 4 })
  const withTrack = makeFlight({ userId: 4, date: '2026-01-01' })
  const withoutTrack = makeFlight({ userId: 4, date: '2026-01-02' })
  const entries = buildFeedEntries(
    [success({ pilotId: 4, pilot, flights: [withTrack, withoutTrack], trackedTripIds: [withTrack.tripId] })],
    10,
  )
  const byTripId = new Map(entries.map((e) => [e.flight.tripId, e.hasTrack]))
  assertEqual(byTripId.get(withTrack.tripId), true, 'buildFeedEntries: a flight whose tripId is tracked reports hasTrack: true')
  assertEqual(
    byTripId.get(withoutTrack.tripId),
    false,
    'buildFeedEntries: a flight whose tripId is NOT tracked reports hasTrack: false',
  )
}

// A pilot with zero flights contributes nothing, without crashing the merge.
{
  const pilot = makePilot({ userId: 5 })
  const entries = buildFeedEntries([success({ pilotId: 5, pilot, flights: [] })], 10)
  assertEqual(entries, [], 'buildFeedEntries: a followed pilot with no flights contributes zero entries')
}

// A failed pilot alongside a successful one: the successful pilot's flights still show,
// the failed pilot contributes no entries (its failure is surfaced separately, see below).
{
  const pilot = makePilot({ userId: 6 })
  const flight = makeFlight({ userId: 6, date: '2026-01-01' })
  const results: PilotFeedResult[] = [success({ pilotId: 6, pilot, flights: [flight] }), failure(7)]
  const entries = buildFeedEntries(results, 10)
  assertEqual(
    entries.map((e) => e.pilot.userId),
    [6],
    'buildFeedEntries: one failed pilot alongside a successful one does not blank the feed — the successful pilot still renders',
  )
}

// All followed pilots failing: an empty feed, not a crash.
assertEqual(
  buildFeedEntries([failure(1), failure(2)], 10),
  [],
  'buildFeedEntries: every followed pilot failing produces an empty feed rather than throwing',
)

// An empty follow list (nothing fetched at all): also an empty feed.
assertEqual(buildFeedEntries([], 10), [], 'buildFeedEntries: no followed pilots produces an empty feed')

// =====================================================================================
// failedPilotResults: a failed pilot must be SURFACED, never silently dropped
// =====================================================================================

{
  const results: PilotFeedResult[] = [
    success({ pilotId: 1 }),
    failure(2, 'flightlog.org returned 502'),
    failure(3, 'network error'),
  ]
  assertEqual(
    failedPilotResults(results),
    [failure(2, 'flightlog.org returned 502'), failure(3, 'network error')],
    'failedPilotResults: exactly the failed pilots are surfaced, with their messages, and successes are excluded',
  )
}

assertEqual(failedPilotResults([success({ pilotId: 1 })]), [], 'failedPilotResults: all pilots succeeding surfaces no failures')

// =====================================================================================
// selectFeedPilotIds: bounding how many followed pilots one feed load fetches at all
// =====================================================================================

{
  const { pilotIds, followedCount } = selectFeedPilotIds([5, 1, 3])
  assertEqual(pilotIds, [1, 3, 5], 'selectFeedPilotIds: pilots are ordered ascending by id, deterministically')
  assertEqual(followedCount, null, 'selectFeedPilotIds: no truncation reported when the follow list fits within the cap')
}

{
  const followed = Array.from({ length: 25 }, (_, index) => index + 1)
  const { pilotIds, followedCount } = selectFeedPilotIds(followed, 20)
  assertEqual(pilotIds.length, 20, 'selectFeedPilotIds: a follow list over the cap is truncated to exactly the cap')
  assertEqual(pilotIds, followed.slice(0, 20), 'selectFeedPilotIds: truncation keeps the lowest ids, deterministically')
  assertEqual(followedCount, 25, 'selectFeedPilotIds: the real followed total is reported so the UI can say so — silent truncation is not acceptable')
}

{
  const followed = Array.from({ length: 20 }, (_, index) => index + 1)
  const { followedCount } = selectFeedPilotIds(followed, 20)
  assertEqual(followedCount, null, 'selectFeedPilotIds: a follow list exactly AT the cap is not reported as truncated')
}

// =====================================================================================
// runWithConcurrencyLimit: the client-side traffic mitigation — bounded in-flight requests,
// and (this pass) an error path that neither drops work nor detaches from the caller.
// =====================================================================================

// A controlled task: only resolves (or rejects) when the test releases it, so the test can
// observe exactly how many are running concurrently, and exercise the rejection path,
// rather than trusting timing or only ever exercising the happy path.
function makeControlledTasks(count: number) {
  const pending: Array<{ resolve: () => void; reject: (error: unknown) => void }> = []
  const starts: number[] = []
  let inFlight = 0
  let maxInFlight = 0

  const run = (item: number) =>
    new Promise<number>((resolve, reject) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      starts.push(item)
      pending.push({
        resolve: () => {
          inFlight--
          resolve(item)
        },
        reject: (error) => {
          inFlight--
          reject(error)
        },
      })
    })

  return {
    items: Array.from({ length: count }, (_, index) => index),
    run,
    releaseAll: () => pending.splice(0).forEach((task) => task.resolve()),
    releaseOne: () => pending.shift()?.resolve(),
    rejectOne: (error: unknown) => pending.shift()?.reject(error),
    rejectAll: (error: unknown) => pending.splice(0).forEach((task) => task.reject(error)),
    pendingCount: () => pending.length,
    maxInFlight: () => maxInFlight,
    startedCount: () => starts.length,
  }
}

async function drain(tasks: ReturnType<typeof makeControlledTasks>): Promise<void> {
  while (tasks.pendingCount() > 0 || tasks.startedCount() < tasks.items.length) {
    tasks.releaseAll()
    await Promise.resolve()
    await Promise.resolve()
  }
}

{
  const LIMIT = 3
  const tasks = makeControlledTasks(10)
  const settled: Array<{ item: number; outcome: Settled<number> }> = []
  const donePromise = runWithConcurrencyLimit(tasks.items, LIMIT, tasks.run, (item, outcome) => settled.push({ item, outcome }))

  // Let the microtask queue drain so every worker has had the chance to start its first task.
  await Promise.resolve()
  await Promise.resolve()
  assert(
    tasks.startedCount() === LIMIT,
    `runWithConcurrencyLimit: with a cap of ${LIMIT} and 10 items, exactly ${LIMIT} start immediately, not all 10`,
  )

  // Drain the rest by releasing one at a time; concurrency must never exceed the cap
  // at any point, including after each release lets the next item start.
  while (tasks.pendingCount() > 0) {
    tasks.releaseOne()
    await Promise.resolve()
    await Promise.resolve()
  }
  await donePromise

  assert(tasks.maxInFlight() <= LIMIT, `runWithConcurrencyLimit: concurrency never exceeds the cap of ${LIMIT} at any point`)
  assertEqual(settled.length, tasks.items.length, 'runWithConcurrencyLimit: every item is eventually settled exactly once')
  assertEqual(
    new Set(settled.map((s) => s.item)),
    new Set(tasks.items),
    'runWithConcurrencyLimit: every distinct item settles, none skipped or duplicated',
  )
  // Pairing checked directly against each item's OWN outcome, not via a sorted array
  // compare — sorting first would silently repair a mis-pairing mutation (item paired
  // with the wrong outcome) before the comparison ever saw it.
  assert(
    settled.every(({ item, outcome }) => outcome.ok && outcome.value === item),
    'runWithConcurrencyLimit: each item is paired with ITS OWN result in onSettled, never another item’s',
  )
}

// A cap of 1 is fully sequential: this is the case a removed/ignored cap breaks most
// visibly, since every item would start at once instead of one at a time.
{
  const tasks = makeControlledTasks(4)
  const donePromise = runWithConcurrencyLimit(tasks.items, 1, tasks.run, () => {})
  await Promise.resolve()
  await Promise.resolve()
  assert(tasks.startedCount() === 1, 'runWithConcurrencyLimit: a cap of 1 starts exactly one item, not all of them')
  tasks.releaseAll()
  // releaseAll only releases what had started; drain the rest sequentially.
  while (tasks.pendingCount() > 0 || tasks.startedCount() < tasks.items.length) {
    await Promise.resolve()
    tasks.releaseAll()
  }
  await donePromise
  assert(tasks.maxInFlight() === 1, 'runWithConcurrencyLimit: a cap of 1 never runs two items concurrently')
}

// A cap larger than the item count: bounded by the item count, not a crash from
// spinning up more workers than there is work for, and still correctly paired.
{
  const tasks = makeControlledTasks(2)
  const settled: Array<{ item: number; outcome: Settled<number> }> = []
  const donePromise = runWithConcurrencyLimit(tasks.items, 10, tasks.run, (item, outcome) => settled.push({ item, outcome }))
  await Promise.resolve()
  await Promise.resolve()
  assert(tasks.startedCount() === 2, 'runWithConcurrencyLimit: a cap larger than the item count still starts every item')
  tasks.releaseAll()
  await donePromise
  assertEqual(
    new Set(settled.map((s) => s.item)),
    new Set(tasks.items),
    'runWithConcurrencyLimit: a cap larger than the item count settles every item exactly once',
  )
  assert(
    settled.every(({ item, outcome }) => outcome.ok && outcome.value === item),
    'runWithConcurrencyLimit: pairing is still correct with idle surplus workers',
  )
}

// --- Error path: nothing dropped, nothing detached, a bad callback isn't fatal ---

// A single rejected item is delivered to onSettled as a failed outcome, not dropped.
{
  const tasks = makeControlledTasks(8)
  const settled: Array<{ item: number; outcome: Settled<number> }> = []
  const donePromise = runWithConcurrencyLimit(tasks.items, 3, tasks.run, (item, outcome) => settled.push({ item, outcome }))
  await Promise.resolve()
  await Promise.resolve()
  tasks.rejectOne(new Error('boom'))
  await drain(tasks)
  await donePromise

  assertEqual(settled.length, tasks.items.length, 'runWithConcurrencyLimit: a rejected item is still delivered to onSettled — none are dropped')
  const rejected = settled.filter((s) => !s.outcome.ok)
  assert(rejected.length === 1, 'runWithConcurrencyLimit: exactly the one rejected item is reported as a failure')
  assert(
    rejected[0]?.outcome.ok === false && rejected[0].outcome.error instanceof Error && rejected[0].outcome.error.message === 'boom',
    'runWithConcurrencyLimit: the failure outcome carries the actual rejection reason, not a generic placeholder',
  )
}

// Every item rejecting still lets every item start and settle — a rejection must not kill
// the worker that hit it, leaving the rest of the shared cursor undrained.
{
  const tasks = makeControlledTasks(10)
  const settled: Array<{ item: number; outcome: Settled<number> }> = []
  const donePromise = runWithConcurrencyLimit(tasks.items, 4, tasks.run, (item, outcome) => settled.push({ item, outcome }))
  while (tasks.pendingCount() > 0 || tasks.startedCount() < tasks.items.length) {
    tasks.rejectAll(new Error('boom'))
    await Promise.resolve()
    await Promise.resolve()
  }
  await donePromise

  assertEqual(settled.length, tasks.items.length, 'runWithConcurrencyLimit: every item rejecting still lets every item start and settle')
  assert(settled.every((s) => !s.outcome.ok), 'runWithConcurrencyLimit: every settled outcome correctly reports the rejection')
}

// The pool must not detach: the returned promise resolves only once every worker has
// actually finished, not as soon as the first item rejects while others are still pending.
{
  const tasks = makeControlledTasks(6)
  const donePromise = runWithConcurrencyLimit(tasks.items, 3, tasks.run, () => {})
  let doneSettled = false
  donePromise.then(() => {
    doneSettled = true
  })

  await Promise.resolve()
  await Promise.resolve()
  tasks.rejectOne(new Error('boom'))
  await Promise.resolve()
  await Promise.resolve()
  assert(
    !doneSettled,
    'runWithConcurrencyLimit: the pool promise does not resolve early just because one item rejected, while other workers are still draining',
  )

  await drain(tasks)
  await donePromise
  assert(doneSettled, 'runWithConcurrencyLimit: the pool promise resolves once every worker has actually finished')
}

// An onSettled callback that throws for one item must not kill the pool: the remaining
// items still reach onSettled, and the returned promise still resolves.
{
  const originalConsoleError = console.error
  console.error = () => {}
  try {
    const tasks = makeControlledTasks(5)
    const settledOk: number[] = []
    let calls = 0
    const donePromise = runWithConcurrencyLimit(tasks.items, 2, tasks.run, (item) => {
      calls++
      if (calls === 1) throw new Error('callback boom')
      settledOk.push(item)
    })
    await drain(tasks)
    await donePromise // must not reject
    assertEqual(
      settledOk.length,
      tasks.items.length - 1,
      'runWithConcurrencyLimit: an onSettled callback throwing for one item does not stop the rest from reaching onSettled',
    )
  } finally {
    console.error = originalConsoleError
  }
}

// limit validation: NaN (and other non-positive-integer values) must reject synchronously,
// having started no workers at all — the old `Math.max(1, Math.min(NaN, n))` behaviour was
// a silent, total no-op that resolved successfully having done nothing.
for (const badLimit of [NaN, 0, -1, 1.5, Infinity]) {
  let rejected = false
  let ranAnything = false
  try {
    await runWithConcurrencyLimit(
      [1, 2, 3],
      badLimit,
      async (item) => {
        ranAnything = true
        return item
      },
      () => {},
    )
  } catch {
    rejected = true
  }
  assert(rejected, `runWithConcurrencyLimit: limit = ${badLimit} rejects instead of silently resolving`)
  assert(!ranAnything, `runWithConcurrencyLimit: limit = ${badLimit} never starts a single worker`)
}

// =====================================================================================
// fetchPilotFeed: talking to our own route handler. Previously had NO coverage at all.
// =====================================================================================

async function withStubbedFetch(stub: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = stub as typeof fetch
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

await withStubbedFetch(
  async () => jsonResponse(200, { pilot: makePilot({ userId: 42 }), flights: [], trackedTripIds: [] }),
  async () => {
    const result = await fetchPilotFeed(42)
    assertEqual(result.status, 'success', 'fetchPilotFeed: a valid 200 response resolves to a success result')
  },
)

await withStubbedFetch(
  async () => jsonResponse(502, { error: 'could not load recent flights for pilot 7' }),
  async () => {
    const result = await fetchPilotFeed(7)
    assertEqual(result.status, 'error', 'fetchPilotFeed: a non-ok response resolves to an error result, not a thrown exception')
    if (result.status === 'error') {
      assertEqual(
        result.message,
        'could not load recent flights for pilot 7',
        'fetchPilotFeed: the server-provided error string is surfaced as-is',
      )
    }
  },
)

await withStubbedFetch(
  async () => jsonResponse(200, { nonsense: true }),
  async () => {
    const result = await fetchPilotFeed(8)
    assertEqual(result.status, 'error', 'fetchPilotFeed: a 200 response with the wrong shape is treated as a failure, not trusted blindly')
  },
)

await withStubbedFetch(
  async () => {
    throw new DOMException('the operation timed out', 'TimeoutError')
  },
  async () => {
    const result = await fetchPilotFeed(11)
    assertEqual(result.status, 'error', 'fetchPilotFeed: a timeout resolves to an error result')
    if (result.status === 'error') {
      assert(result.message.includes('timed out'), 'fetchPilotFeed: a timeout produces a message that says so, not a raw DOMException string')
    }
  },
)

await withStubbedFetch(
  async () => {
    throw new DOMException('the operation was aborted', 'AbortError')
  },
  async () => {
    const result = await fetchPilotFeed(12)
    assertEqual(result.status, 'error', 'fetchPilotFeed: an aborted request resolves to an error result')
    if (result.status === 'error') {
      assert(result.message.includes('cancelled'), 'fetchPilotFeed: an aborted request produces a message that says so')
    }
  },
)

// No stub here: fetchPilotFeed's relative URL fails to parse under Node's fetch, a real
// network-shaped failure. This is exactly the try/catch this function has around its own
// fetch call — the mutation that deletes it makes THIS reject instead of resolve.
{
  let threw = false
  let result: PilotFeedResult | undefined
  try {
    result = await fetchPilotFeed(999)
  } catch {
    threw = true
  }
  assert(!threw, 'fetchPilotFeed: a network-level failure is caught and turned into a result, never rethrown')
  assertEqual(result?.status, 'error', 'fetchPilotFeed: a network-level failure resolves to a failure result')
}

// =====================================================================================
// FlightFeedView / FeedView: pure presentational components (no hooks), rendered with
// react-dom/server against literal props. This is what actually exercises the hydration
// guard and the failure-surfacing wiring end to end without a browser — pure logic tests
// on feed.ts alone cannot see a JSX prop wired to the wrong value.
// =====================================================================================

{
  const beforeHydration = renderToStaticMarkup(
    createElement(FlightFeedView, { hasHydrated: false, followedIds: new Set<number>(), defaultPilotId: 1 }),
  )
  assert(
    !beforeHydration.includes('Recent flights'),
    'FlightFeedView: renders the hydration skeleton, not real content, before hasHydrated is true',
  )

  const afterHydration = renderToStaticMarkup(
    createElement(FlightFeedView, { hasHydrated: true, followedIds: new Set<number>(), defaultPilotId: 1 }),
  )
  assert(afterHydration.includes('Recent flights'), 'FlightFeedView: renders real content once hasHydrated is true')
}

{
  const withFailure = renderToStaticMarkup(
    createElement(FeedView, {
      shownCount: 1,
      followedCount: null,
      isLoading: false,
      entries: [],
      failedPilots: [failure(9, 'could not load recent flights for pilot 9')],
    }),
  )
  assert(
    withFailure.includes('Pilot 9') && withFailure.includes('could not load recent flights for pilot 9'),
    'FeedView: a non-empty failedPilots prop actually renders the failure notice with its message',
  )

  const withoutFailure = renderToStaticMarkup(
    createElement(FeedView, { shownCount: 1, followedCount: null, isLoading: false, entries: [], failedPilots: [] }),
  )
  assert(
    !withoutFailure.includes('could not be loaded'),
    'FeedView: an empty failedPilots prop renders no failure notice',
  )
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
