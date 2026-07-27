import { inspect } from 'node:util'
import {
  createRequestGate,
  RequestGateTimeoutError,
  type GateClock,
} from '../src/lib/concurrency/request-gate'
import {
  REQUEST_GATE_LIMIT,
  REQUEST_GATE_MIN_SPACING_MS,
  REQUEST_GATE_TIMEOUT_MS,
  flightlogRequestGate,
} from '../src/lib/flightlog/outbound-gate'
import { CONCURRENCY_LIMIT } from '../src/features/browse-flight-feed/use-flight-feed'
import { MAX_YEARS_PER_PILOT } from '../src/features/browse-flight-feed/feed'

// No real-time watchdog: every fake-clock assertion below settles within a handful of
// microtask ticks by construction (virtual time, not real waiting), so a mutation that
// truly deadlocks one (e.g. removing the timeout so a hung task's promise never settles)
// surfaces as Node's own "Detected unsettled top-level await" diagnostic — which also
// names the exact line — faster than any fixed-duration watchdog could, and without a
// process.exit(1) racing ahead of that diagnostic and this file's own summary line. The
// one block that uses real timers (production gate sizing, below) is built to always
// settle on its own regardless of mutation, so it needs no watchdog either — see its comment.

let failures = 0

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const pass = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'ok' : 'FAIL'} - ${label}`)
  if (!pass) {
    failures++
    console.error(`  expected: ${inspect(expected)}`)
    console.error(`  actual:   ${inspect(actual)}`)
  }
}

// =====================================================================================
// A fake clock: `setTimer` never actually waits, it just records a due time. `advance`
// moves virtual time forward and fires whatever timers are now due, in due-time order,
// flushing real microtasks between each firing so a callback that schedules a NEW timer
// (e.g. the gate rescheduling its own spacing wakeup) is seen before the next one fires.
// This is what lets the spacing and timeout tests assert exact elapsed values instead of
// trusting real setTimeout delays, which would be both slow and flaky.
// =====================================================================================

type FakeClock = GateClock & { advance(ms: number): Promise<void>; pendingTimerCount(): number }

// Flushes to quiescence rather than a fixed tick count: a macrotask boundary only runs
// once every microtask queued ahead of it (including ones scheduled BY earlier ones, at
// any depth) has drained, so this can't under-flush as the gate's own await depth grows —
// a fixed tick budget silently could.
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function createFakeClock(): FakeClock {
  let time = 0
  let nextId = 0
  const timers = new Map<number, { dueAt: number; callback: () => void }>()

  return {
    now: () => time,
    setTimer(ms, callback) {
      const id = nextId++
      timers.set(id, { dueAt: time + ms, callback })
      return () => {
        timers.delete(id)
      }
    },
    async advance(ms) {
      const target = time + ms
      await flushMicrotasks()
      for (;;) {
        let next: [number, { dueAt: number; callback: () => void }] | undefined
        for (const entry of timers) {
          if (entry[1].dueAt <= target && (!next || entry[1].dueAt < next[1].dueAt)) next = entry
        }
        if (!next) break
        timers.delete(next[0])
        time = next[1].dueAt
        next[1].callback()
        await flushMicrotasks()
      }
      time = target
    },
    pendingTimerCount: () => timers.size,
  }
}

// A caller-controlled task: only starts recording as "started" and only settles when the
// test explicitly tells it to, so the test observes exactly when the gate admits it rather
// than trusting timing.
function makeControlledTask() {
  let resolveFn!: (value: string) => void
  let rejectFn!: (error: unknown) => void
  let started = false
  let seenSignal: AbortSignal | undefined
  const promise = new Promise<string>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })
  return {
    task: (signal: AbortSignal): Promise<string> => {
      started = true
      seenSignal = signal
      return promise
    },
    resolve: (value: string) => resolveFn(value),
    reject: (error: unknown) => rejectFn(error),
    started: () => started,
    signal: () => seenSignal,
  }
}

// A shared harness of N controlled tasks, tracking in-flight count and start order across
// all of them at once — what lets the concurrency and fairness assertions check a real
// property (max concurrent, actual start order) instead of a per-task shape.
function makeHarness(count: number) {
  const pending: Array<{ index: number; resolve: () => void }> = []
  const startOrder: number[] = []
  let inFlight = 0
  let maxInFlight = 0

  const runFns = Array.from(
    { length: count },
    (_, index) =>
      (): Promise<number> =>
        new Promise<number>((resolve) => {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          startOrder.push(index)
          pending.push({
            index,
            resolve: () => {
              inFlight--
              resolve(index)
            },
          })
        }),
  )

  return {
    runFns,
    releaseOldest: () => pending.shift()?.resolve(),
    releaseAll: () => pending.splice(0).forEach((entry) => entry.resolve()),
    pendingCount: () => pending.length,
    startedCount: () => startOrder.length,
    startOrder,
    maxInFlight: () => maxInFlight,
  }
}

// =====================================================================================
// Production sizing: pinned to hardcoded expected values, and the worst-case latency math
// worked out independently of the gate's own admission logic — not derived by running the
// gate and reading back what it did, which could never catch a wrong constant.
// =====================================================================================

assertEqual(REQUEST_GATE_LIMIT, 4, 'REQUEST_GATE_LIMIT is pinned to 4')
assertEqual(REQUEST_GATE_MIN_SPACING_MS, 50, 'REQUEST_GATE_MIN_SPACING_MS is pinned to 50')
assertEqual(REQUEST_GATE_TIMEOUT_MS, 8_000, 'REQUEST_GATE_TIMEOUT_MS is pinned to 8000')

{
  // One isolated recent-flights route call: 1 logbook fetch, sequential, then
  // MAX_YEARS_PER_PILOT track-year fetches requested concurrently. Only those concurrent
  // ones can contend with EACH OTHER on the spacing floor in isolation.
  const singleRouteCallWorstCaseMs = (MAX_YEARS_PER_PILOT - 1) * REQUEST_GATE_MIN_SPACING_MS
  assertEqual(singleRouteCallWorstCaseMs, 50, 'sizing: one isolated recent-flights call adds at most 50ms of spacing-induced latency (its own 2 concurrent track-year fetches, 1 gap between them)')

  // A full feed page load: CONCURRENCY_LIMIT pilots fetched concurrently client-side (see
  // use-flight-feed.ts), each driving 1 + MAX_YEARS_PER_PILOT raw fetches through this ONE
  // shared server-side gate in the common (no session-remint) case.
  const rawFetchesPerFeedLoad = CONCURRENCY_LIMIT * (1 + MAX_YEARS_PER_PILOT)
  assertEqual(rawFetchesPerFeedLoad, 12, 'sizing: a full feed load drives 12 raw fetches through the shared gate (4 pilots x [1 logbook + 2 track-year fetches])')

  // Dispatching N requests through a spacing floor costs at least (N-1) x spacing to START
  // the last one, regardless of how many run concurrently — this is the number that
  // multiplies into visible page-load latency.
  const feedLoadWorstCaseMs = (rawFetchesPerFeedLoad - 1) * REQUEST_GATE_MIN_SPACING_MS
  assertEqual(feedLoadWorstCaseMs, 550, 'sizing: the worst-case spacing-added latency to fully DISPATCH a full 4-pilot feed load is 550ms')

  // fetch-pilot-feed.ts's own FETCH_TIMEOUT_MS (15_000) is private to that module and not
  // imported here — this is a separate, independently chosen ceiling being checked against,
  // not the constant under test being echoed back at itself.
  const CLIENT_SIDE_TIMEOUT_CEILING_MS = 15_000
  assert(feedLoadWorstCaseMs < CLIENT_SIDE_TIMEOUT_CEILING_MS, 'sizing: the full feed load worst case (550ms) stays far under the browser-side 15s ceiling')

  // This model counts only the common (no session-remint) case. A session gate on every
  // fetch can drive one logical fetchFlightlog call to 4 gated calls (mint, first attempt,
  // re-mint, retry) instead of 1, worst-casing nearer 48 gated fetches and ~2350ms of
  // spacing — see outbound-gate.ts's REQUEST_GATE_MIN_SPACING_MS comment. The conclusion
  // above (well under 15s) still holds; this note exists so the 550ms figure is never read
  // as a hard ceiling.
}

// =====================================================================================
// The production instance itself, not just its constants: everything above pins
// REQUEST_GATE_LIMIT/MIN_SPACING_MS/TIMEOUT_MS and derives latency math from them, but
// none of that touches flightlogRequestGate — a mutation to the createRequestGate({ ... })
// call itself (wrong option mapped to wrong constant, a hardcoded value replacing a
// constant) would sail through every assertion above. Drives the real, assembled instance
// with real (not fake-clock) timing instead.
// =====================================================================================

{
  // CALLERS is the pinned REQUEST_GATE_LIMIT (4, asserted above) + 1, hardcoded rather
  // than derived from the live import: deriving both the caller count AND the wait below
  // from REQUEST_GATE_LIMIT would make a LIMIT mutation (e.g. to 999) launch as many real
  // callers and wait as long as the mutated value says, risking a real 8s-timeout crash
  // instead of a clean assertion failure. A fixed, small count catches the same mutation —
  // with limit=999 every one of these 5 gets admitted, so `started` (5) simply won't match
  // the mutated REQUEST_GATE_LIMIT (999) it's compared against below.
  const CALLERS = 5
  const releases: Array<() => void> = []
  let started = 0
  const runs = Array.from({ length: CALLERS }, () =>
    flightlogRequestGate
      .run(async () => {
        started++
        await new Promise<void>((resolve) => releases.push(resolve))
      })
      // A too-small TIMEOUT_MS mutation (tested separately, below) can reject one of these
      // for real while it's deliberately still held open — caught here so that surfaces as
      // this block's own assertions going red, not as an unhandled rejection crash.
      .catch(() => undefined),
  )

  // Spacing (real, ~50ms/start) and the concurrency limit both gate admission, so a short
  // wait would under-count startedCount for a reason that has nothing to do with the
  // limit. Waiting out spacing's own worst case for (CALLERS-1) admissions first isolates
  // the limit as the only remaining reason the 5th caller is still queued. Capped so a
  // MIN_SPACING_MS mutation (also tested separately) can't turn this into a long real wait.
  const spacingWaitMs = Math.min((CALLERS - 1) * REQUEST_GATE_MIN_SPACING_MS, 2000) + 100
  await new Promise((resolve) => setTimeout(resolve, spacingWaitMs))
  assertEqual(started, REQUEST_GATE_LIMIT, `production gate: the real flightlogRequestGate admits exactly ${REQUEST_GATE_LIMIT} of ${CALLERS} real concurrent callers`)

  // Releasing only the ones started so far would miss any caller that starts only once
  // one of these releases frees its slot — so this keeps releasing whatever is newly
  // pending until every one of them has both started and been released.
  while (releases.length > 0 || started < CALLERS) {
    releases.splice(0).forEach((release) => release())
    if (started < CALLERS) await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await Promise.all(runs)
}

{
  const starts: number[] = []
  const runs = Array.from({ length: 2 }, () =>
    flightlogRequestGate.run(async () => {
      starts.push(performance.now())
    }),
  )
  await Promise.all(runs)
  const gapMs = starts[1]! - starts[0]!
  const TOLERANCE_MS = 5 // real-timer jitter, not a looseness in what's being asserted
  assert(
    gapMs >= REQUEST_GATE_MIN_SPACING_MS - TOLERANCE_MS,
    `production gate: the real flightlogRequestGate enforces >= ~${REQUEST_GATE_MIN_SPACING_MS}ms between real starts (measured ${gapMs.toFixed(1)}ms)`,
  )
}

// =====================================================================================
// Option validation
// =====================================================================================

for (const badLimit of [NaN, 0, -1, 1.5, Infinity]) {
  let threw = false
  try {
    createRequestGate({ limit: badLimit, minSpacingMs: 0, timeoutMs: 1000 })
  } catch (error) {
    threw = error instanceof RangeError
  }
  assert(threw, `createRequestGate: limit = ${badLimit} throws a RangeError instead of silently accepting it`)
}

for (const badSpacing of [NaN, -1, -Infinity]) {
  let threw = false
  try {
    createRequestGate({ limit: 1, minSpacingMs: badSpacing, timeoutMs: 1000 })
  } catch (error) {
    threw = error instanceof RangeError
  }
  assert(threw, `createRequestGate: minSpacingMs = ${badSpacing} throws a RangeError`)
}

for (const badTimeout of [NaN, 0, -1]) {
  let threw = false
  try {
    createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: badTimeout })
  } catch (error) {
    threw = error instanceof RangeError
  }
  assert(threw, `createRequestGate: timeoutMs = ${badTimeout} throws a RangeError`)
}

// =====================================================================================
// Zero, one, many waiters
// =====================================================================================

{
  // Zero waiters: a gate that is never used must not throw or hang on construction alone.
  const clock = createFakeClock()
  createRequestGate({ limit: 3, minSpacingMs: 10, timeoutMs: 1000, clock })
  assert(true, 'zero waiters: constructing a gate that is never run does not throw')
}

{
  // One waiter: starts immediately, with no spacing predecessor to wait behind.
  const clock = createFakeClock()
  const gate = createRequestGate({ limit: 2, minSpacingMs: 50, timeoutMs: 1000, clock })
  const t = makeControlledTask()
  const result = gate.run(t.task)
  await flushMicrotasks()
  assert(t.started(), 'one waiter: the sole caller starts immediately, with no predecessor to space against')
  t.resolve('solo')
  assertEqual(await result, 'solo', 'one waiter: run() resolves with the task value')
}

{
  // Many waiters, well above the limit: concurrency never exceeds it, including for
  // callers that arrive only AFTER the gate is already fully saturated.
  const clock = createFakeClock()
  const LIMIT = 3
  const gate = createRequestGate({ limit: LIMIT, minSpacingMs: 0, timeoutMs: 1_000_000, clock })
  const harness = makeHarness(9)

  const firstBatch = harness.runFns.slice(0, 6).map((fn) => gate.run(fn))
  await flushMicrotasks()
  assertEqual(harness.startedCount(), LIMIT, `many waiters: exactly ${LIMIT} of 6 immediate callers start, the rest queue`)

  // Two MORE callers arrive while the gate is already saturated — they must not jump in.
  const lateBatch = harness.runFns.slice(6, 9).map((fn) => gate.run(fn))
  await flushMicrotasks()
  assertEqual(harness.startedCount(), LIMIT, 'many waiters: callers arriving while the gate is saturated do not start early')

  // Drain everything one release at a time; concurrency must never exceed LIMIT at any point.
  while (harness.pendingCount() > 0 || harness.startedCount() < 9) {
    harness.releaseOldest()
    await flushMicrotasks()
  }
  await Promise.all([...firstBatch, ...lateBatch])

  assert(harness.maxInFlight() <= LIMIT, `many waiters: concurrency never exceeded ${LIMIT} at any point, including late arrivals`)
  assertEqual(harness.startedCount(), 9, 'many waiters: every caller, early and late, eventually started exactly once')
}

// =====================================================================================
// Minimum spacing between request STARTS — real elapsed values against the fake clock,
// not a loose "at least 0ms" check.
// =====================================================================================

{
  const clock = createFakeClock()
  const SPACING = 25
  // Limit is deliberately generous so only spacing, never concurrency, is what's binding.
  const gate = createRequestGate({ limit: 10, minSpacingMs: SPACING, timeoutMs: 1_000_000, clock })
  const startTimes: number[] = []
  const tasks = Array.from({ length: 4 }, () => makeControlledTask())
  const results = tasks.map((t) =>
    gate.run((signal) => {
      startTimes.push(clock.now())
      return t.task(signal)
    }),
  )

  await flushMicrotasks()
  assertEqual(startTimes.length, 1, 'min spacing: only the first of 4 simultaneous arrivals starts immediately, even though the concurrency limit (10) would allow all 4')

  await clock.advance(SPACING - 1)
  assertEqual(startTimes.length, 1, `min spacing: the second start has not happened yet at ${SPACING - 1}ms, one ms short of the floor`)

  await clock.advance(1)
  assertEqual(startTimes.length, 2, `min spacing: the second start happens at exactly ${SPACING}ms since the first`)

  await clock.advance(SPACING)
  assertEqual(startTimes.length, 3, 'min spacing: the third start happens one spacing interval after the second')

  await clock.advance(SPACING)
  assertEqual(startTimes.length, 4, 'min spacing: the fourth start happens one spacing interval after the third')

  assertEqual(
    [startTimes[1]! - startTimes[0]!, startTimes[2]! - startTimes[1]!, startTimes[3]! - startTimes[2]!],
    [SPACING, SPACING, SPACING],
    'min spacing: consecutive starts are exactly SPACING ms apart, not merely "eventually" apart',
  )

  tasks.forEach((t, i) => t.resolve(`v${i}`))
  await Promise.all(results)
}

// =====================================================================================
// FIFO fairness: a late caller cannot jump a queued one.
// =====================================================================================

{
  const clock = createFakeClock()
  const gate = createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: 1_000_000, clock })
  const harness = makeHarness(4)

  const first = gate.run(harness.runFns[0]!) // admitted immediately, occupies the only slot
  await flushMicrotasks()
  const second = gate.run(harness.runFns[1]!) // queues behind the held slot
  const third = gate.run(harness.runFns[2]!) // queues behind `second`
  await flushMicrotasks()
  // A late arrival, after both are already queued.
  const fourth = gate.run(harness.runFns[3]!)
  await flushMicrotasks()

  harness.releaseOldest() // frees the slot held by `first`
  await flushMicrotasks()
  harness.releaseOldest()
  await flushMicrotasks()
  harness.releaseOldest()
  await flushMicrotasks()
  harness.releaseOldest()
  await flushMicrotasks()
  await Promise.all([first, second, third, fourth])

  assertEqual(
    harness.startOrder,
    [0, 1, 2, 3],
    'FIFO: callers are admitted strictly in arrival order — the late 4th caller runs last, never ahead of the 2nd or 3rd, which were already queued when it arrived',
  )
}

// =====================================================================================
// Rejection releases its slot.
// =====================================================================================

{
  const clock = createFakeClock()
  const gate = createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: 1_000_000, clock })
  const failing = makeControlledTask()
  const failure = new Error('upstream exploded')

  const runPromise = gate.run(failing.task)
  await flushMicrotasks()
  failing.reject(failure)

  let caught: unknown
  try {
    await runPromise
  } catch (error) {
    caught = error
  }
  assert(caught === failure, 'rejection: the gate propagates the task\'s own rejection reason unchanged')

  const next = makeControlledTask()
  const nextPromise = gate.run(next.task)
  await flushMicrotasks()
  assert(next.started(), 'rejection: a rejected task releases its slot — the next caller (limit=1) starts right away instead of hanging behind it')
  next.resolve('ok')
  await nextPromise
}

// =====================================================================================
// Timeout: fires a distinguishable error, aborts the task's signal, and releases the slot.
// =====================================================================================

{
  const clock = createFakeClock()
  const TIMEOUT = 100
  const gate = createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: TIMEOUT, clock })
  const hung = makeControlledTask() // deliberately never resolved or rejected by the test

  const runPromise = gate.run(hung.task)
  await flushMicrotasks()
  assert(hung.started(), 'timeout: the task starts normally before the timeout elapses')

  await clock.advance(TIMEOUT - 1)
  let settledEarly = false
  runPromise.then(
    () => (settledEarly = true),
    () => (settledEarly = true),
  )
  await flushMicrotasks()
  assert(!settledEarly, `timeout: has not fired yet at ${TIMEOUT - 1}ms, one ms short of the ${TIMEOUT}ms ceiling`)

  await clock.advance(1)
  let caught: unknown
  try {
    await runPromise
    assert(false, 'timeout: run() should have rejected once the timeout elapsed')
  } catch (error) {
    caught = error
  }
  assert(caught instanceof RequestGateTimeoutError, 'timeout: rejects with a distinguishable RequestGateTimeoutError, not a generic Error')
  assert(
    caught instanceof Error && caught.message.includes(`${TIMEOUT}`),
    'timeout: the error message names the actual timeout value, not a placeholder',
  )
  assert(
    hung.signal()?.aborted === true,
    'timeout: the AbortSignal handed to the task is aborted once the timeout fires, so a real fetch would actually tear its connection down',
  )

  // Slot released: a task that hangs forever must not hold its slot forever. limit=1, so
  // this only starts if the timed-out task's slot was actually freed.
  const next = makeControlledTask()
  const nextPromise = gate.run(next.task)
  await flushMicrotasks()
  assert(next.started(), 'timeout: a timed-out request releases its slot — the next caller (limit=1) starts right away')
  next.resolve('ok')
  await nextPromise
}

// =====================================================================================
// No leaked timers: a caller signal to cancel a queued wait, and reentrant nested calls,
// were both removed from the gate (see concurrency/request-gate.ts's doc comment) — no
// production caller ever used the signal option, and no production caller calls a gated
// task from inside another gate.run(). Both were speculative surface with a real cost:
// the reentrancy escape hatch skipped enqueue() entirely, silently exempting a caller from
// the limit, the FIFO queue, and the spacing floor at once the moment a future refactor
// happened to nest two gated calls — exactly the shape this gate exists to bound.
//
// What stays observable here instead: a spacing wakeup scheduled while one is already
// pending must replace it, not accumulate a duplicate — and every timer (spacing or
// per-call timeout) must be gone once every caller has completed.
// =====================================================================================

{
  const clock = createFakeClock()
  const LIMIT = 2
  const gate = createRequestGate({ limit: LIMIT, minSpacingMs: 20, timeoutMs: 1000, clock })
  const harness = makeHarness(3)

  const runs = harness.runFns.map((fn) => gate.run(fn))
  await flushMicrotasks()

  // 1 timeout timer for the admitted caller, + 1 spacing wakeup for the two still queued
  // behind it — not 2 spacing wakeups, which is what an un-cancelled second scheduling
  // call would leave behind alongside the first.
  assertEqual(clock.pendingTimerCount(), 2, 'no leaked timers: a later spacing wakeup replaces the pending one instead of accumulating a duplicate')

  while (harness.pendingCount() > 0 || harness.startedCount() < 3) {
    harness.releaseOldest()
    await clock.advance(20)
  }
  await Promise.all(runs)
  assertEqual(clock.pendingTimerCount(), 0, 'no leaked timers: nothing remains pending once every caller has completed normally')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
