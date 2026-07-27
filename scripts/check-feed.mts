import {
  buildFeedEntries,
  failedPilotResults,
  sliceRecentFlights,
  type PilotFeedFailure,
  type PilotFeedResult,
  type PilotFeedSuccess,
} from '../src/features/browse-flight-feed/feed'
import { runWithConcurrencyLimit } from '../src/lib/concurrency/with-limit'
import type { Flight, Pilot } from '../src/lib/flightlog/types'

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
// sliceRecentFlights: the per-pilot recent slice, and the traffic-safety year derivation
// =====================================================================================

// The unmissable one: an 18-year history (matches the fixture pilot in AGENTS.md/the
// scout pass — flightlog.org spans 2008 to 2026), one flight per year so every year is
// individually distinguishable. A slice of the 3 most recent flights must touch only the
// 3 most recent years, never all 18 — that collapse is the entire traffic-safety property
// this function exists for (see its doc comment and docs/flightlog-api.md).
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
    [2025, 2024, 2023],
    'sliceRecentFlights: years are derived from the 3-flight SLICE, not the 18-year history — 3 years, not 18',
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
// runWithConcurrencyLimit: the client-side traffic mitigation — bounded in-flight requests
// =====================================================================================

// A controlled task: only resolves when the test releases it, so the test can observe
// exactly how many are running concurrently at once rather than trusting timing.
function makeControlledTasks(count: number) {
  const releases: Array<() => void> = []
  const starts: number[] = []
  let inFlight = 0
  let maxInFlight = 0

  const run = (item: number) =>
    new Promise<number>((resolve) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      starts.push(item)
      releases.push(() => {
        inFlight--
        resolve(item)
      })
    })

  return {
    items: Array.from({ length: count }, (_, index) => index),
    run,
    releaseAll: () => releases.splice(0).forEach((release) => release()),
    releaseOne: () => releases.shift()?.(),
    pendingCount: () => releases.length,
    maxInFlight: () => maxInFlight,
    startedCount: () => starts.length,
  }
}

{
  const LIMIT = 3
  const tasks = makeControlledTasks(10)
  const settled: number[] = []
  const donePromise = runWithConcurrencyLimit(tasks.items, LIMIT, tasks.run, (item) => settled.push(item))

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
  assertEqual(
    [...settled].sort((a, b) => a - b),
    tasks.items,
    'runWithConcurrencyLimit: every item is eventually settled exactly once',
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
// spinning up more workers than there is work for.
{
  const tasks = makeControlledTasks(2)
  const settled: number[] = []
  const donePromise = runWithConcurrencyLimit(tasks.items, 10, tasks.run, (item) => settled.push(item))
  await Promise.resolve()
  await Promise.resolve()
  assert(tasks.startedCount() === 2, 'runWithConcurrencyLimit: a cap larger than the item count still starts every item')
  tasks.releaseAll()
  await donePromise
  assertEqual([...settled].sort((a, b) => a - b), [0, 1], 'runWithConcurrencyLimit: a cap larger than the item count settles every item')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
