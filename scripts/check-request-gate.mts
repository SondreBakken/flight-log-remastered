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
  gatedFetch,
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

// Object.is at every leaf, not JSON.stringify: stringify collapses distinct values to the
// same text (NaN and null both become "null"; undefined and a function both become
// `undefined`, the non-string), so it can call two genuinely different values equal. This
// only walks arrays and plain objects, which is everything this file ever compares.
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => deepEqual(value, b[index]))
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const aEntries = Object.entries(a as Record<string, unknown>)
    const bRecord = b as Record<string, unknown>
    return (
      aEntries.length === Object.keys(bRecord).length &&
      aEntries.every(([key, value]) => deepEqual(value, bRecord[key]))
    )
  }
  return false
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const pass = deepEqual(actual, expected)
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

// Bounds every "release/advance until N have started" polling loop below. Without this, a
// mutation that stops the gate making progress (e.g. dropping pump() from release()) turns
// a bounded wait into a real hang — measured at 25+ real seconds with no output and no
// diagnostic, since a loop that keeps DOING something (releasing, advancing) each iteration
// never goes idle, so Node's own unsettled-top-level-await diagnostic (which only fires on
// an idle event loop) never fires either. `step` is expected to already yield to a real
// macrotask itself (a fake clock's advance() does via setImmediate; a real-timer block uses
// an actual setTimeout) — this only adds the missing bound and a loud, specific failure.
async function drainUntil(label: string, isDone: () => boolean, step: () => Promise<void>): Promise<void> {
  const MAX_ITERATIONS = 1000
  for (let i = 0; !isDone(); i++) {
    if (i >= MAX_ITERATIONS) {
      throw new Error(`${label}: gate made no further progress after ${MAX_ITERATIONS} drain iterations — likely stalled`)
    }
    await step()
  }
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

  // fetch-pilot-feed.ts's own FETCH_TIMEOUT_MS (15_000, well above the 550ms figure above)
  // is private to that module and not imported here, and not asserted against directly —
  // feedLoadWorstCaseMs is already pinned to an exact value (550) above, so a `< 15000`
  // check on top of it can only ever fail once that pin has already failed. Documented
  // here, not asserted, so it stays honest about being commentary rather than coverage.
  //
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
  await drainUntil(
    'production gate: draining 5 real callers',
    () => releases.length === 0 && started === CALLERS,
    async () => {
      releases.splice(0).forEach((release) => release())
      if (started < CALLERS) await new Promise((resolve) => setTimeout(resolve, 10))
    },
  )
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
  await drainUntil(
    'many waiters: draining 9 callers',
    () => harness.pendingCount() === 0 && harness.startedCount() === 9,
    async () => {
      harness.releaseOldest()
      await flushMicrotasks()
    },
  )
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

{
  // The spacing test above uses limit=10 against 4 waiters, so it never exercises a freed
  // slot being handed back into an ALREADY-SATURATED pool — every admission there is into
  // an idle slot. lastStartTime is one shared value for the whole gate, not one per slot,
  // so spacing has to keep binding across reuse too: saturate to LIMIT concurrently first,
  // then keep releasing only the oldest active task (freeing a slot while the rest stay in
  // flight) and re-admitting from the same queue, and check every start globally, not per
  // slot, is still >= SPACING apart.
  const clock = createFakeClock()
  const LIMIT = 4
  const SPACING = 30
  const gate = createRequestGate({ limit: LIMIT, minSpacingMs: SPACING, timeoutMs: 1_000_000, clock })
  const COUNT = 12
  const startTimes: number[] = []
  const active: Array<() => void> = []

  const runs = Array.from({ length: COUNT }, () =>
    gate.run(
      () =>
        new Promise<void>((resolve) => {
          startTimes.push(clock.now())
          active.push(resolve)
        }),
    ),
  )
  await flushMicrotasks()

  await drainUntil(
    'spacing survives slot reuse: saturating to the concurrency limit',
    () => startTimes.length >= LIMIT,
    () => clock.advance(SPACING),
  )
  assertEqual(active.length, LIMIT, `spacing survives slot reuse: exactly ${LIMIT} tasks are concurrently active once saturated`)

  await drainUntil(
    'spacing survives slot reuse: draining the remaining callers',
    () => startTimes.length === COUNT,
    async () => {
      active.shift()!() // free the oldest active slot; the rest stay in flight
      await clock.advance(SPACING)
    },
  )
  active.splice(0).forEach((release) => release())
  await Promise.all(runs)

  const gaps = startTimes.slice(1).map((t, i) => t - startTimes[i]!)
  assert(
    gaps.every((gap) => gap >= SPACING),
    `spacing survives slot reuse: every one of ${COUNT} starts (limit ${LIMIT}, slots reused under saturation) is >= ${SPACING}ms after the previous start (gaps: ${gaps.join(', ')})`,
  )
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

{
  // A task that throws SYNCHRONOUSLY, before ever returning a promise, must still cancel
  // the timeout timer set for it — run() rejecting correctly is not enough on its own, the
  // timer that would otherwise fire TIMEOUT ms later has to actually be torn down too.
  const clock = createFakeClock()
  const TIMEOUT = 1000
  const gate = createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: TIMEOUT, clock })
  const thrown = new Error('synchronous boom')

  let caught: unknown
  try {
    await gate.run(() => {
      throw thrown
    })
  } catch (error) {
    caught = error
  }
  assert(caught === thrown, "sync throw: run() rejects with the task's own synchronously-thrown error, unchanged")
  assertEqual(clock.pendingTimerCount(), 0, 'sync throw: the timeout timer set for the task is cancelled, not leaked, when the task throws synchronously')
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

  await drainUntil(
    'no leaked timers: draining 3 callers',
    () => harness.pendingCount() === 0 && harness.startedCount() === 3,
    async () => {
      harness.releaseOldest()
      await clock.advance(20)
    },
  )
  await Promise.all(runs)
  assertEqual(clock.pendingTimerCount(), 0, 'no leaked timers: nothing remains pending once every caller has completed normally')
}

// =====================================================================================
// gatedFetch: the shared function outbound-gate.ts exports so http.ts's two call sites can
// be one-liners, instead of each hand-rolling its own gate.run(fetch(...)) — this is what
// makes the actual outbound path testable at all despite http.ts itself living behind
// 'server-only'. Takes an injectable gate (production callers never pass one, so they
// always run through the real singleton) so these can drive a fake clock instead of paying
// for the real 8s production timeout on every check run — see gatedFetch's own doc comment.
// =====================================================================================

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>): () => void {
  const original = globalThis.fetch
  globalThis.fetch = handler as unknown as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

{
  // Acquires a slot: concurrent calls beyond the gate's limit must queue behind it exactly
  // like any other task, not bypass it because they're routed through gatedFetch.
  const clock = createFakeClock()
  const LIMIT = 2
  const gate = createRequestGate({ limit: LIMIT, minSpacingMs: 0, timeoutMs: 1_000_000, clock })
  const releases: Array<() => void> = []
  const restoreFetch = stubFetch(
    () =>
      new Promise<Response>((resolve) => {
        releases.push(() => resolve(new Response('', { status: 200 })))
      }),
  )

  const COUNT = 5
  const runs = Array.from({ length: COUNT }, (_, i) => gatedFetch(`https://example.test/${i}`, {}, gate))
  await flushMicrotasks()
  assertEqual(releases.length, LIMIT, `gatedFetch: acquires a slot — only ${LIMIT} of ${COUNT} concurrent calls reach fetch(), the rest queue behind the gate`)

  await drainUntil(
    'gatedFetch acquires a slot: draining',
    () => releases.length === 0 && runs.length === COUNT,
    async () => {
      releases.splice(0).forEach((release) => release())
      await flushMicrotasks()
    },
  )
  await Promise.all(runs)
  restoreFetch()
}

{
  // Applies the timeout: a fetch() that never settles must still be bounded by the gate's
  // timeout, and the signal handed to fetch() must be the one that aborts.
  const clock = createFakeClock()
  const TIMEOUT = 500
  const gate = createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: TIMEOUT, clock })
  let capturedSignal: AbortSignal | undefined
  const restoreFetch = stubFetch((_url, init) => {
    capturedSignal = init?.signal ?? undefined
    return new Promise<Response>(() => {}) // never settles — simulates a hung connection
  })

  const resultPromise = gatedFetch('https://example.test/hang', {}, gate)
  // Attached before advancing the clock, not after — the timeout fires DURING advance()
  // below, and a promise with no handler attached yet at that moment is what Node's own
  // unhandled-rejection detection flags as a crash, even though the try/await further down
  // handles it "for real" a few lines later.
  void resultPromise.catch(() => undefined)
  await flushMicrotasks()
  assert(
    capturedSignal !== undefined && !capturedSignal.aborted,
    'gatedFetch: applies the timeout — fetch() is called with a not-yet-aborted signal',
  )

  await clock.advance(TIMEOUT)
  let caught: unknown
  try {
    await resultPromise
  } catch (error) {
    caught = error
  }
  assert(
    caught instanceof RequestGateTimeoutError,
    "gatedFetch: applies the timeout — a hung fetch() rejects with RequestGateTimeoutError once the gate's timeout elapses",
  )
  assert(capturedSignal?.aborted === true, 'gatedFetch: applies the timeout — the signal handed to fetch() is aborted once the timeout fires')
  restoreFetch()
}

{
  // Headers-then-stall probe: a server that resolves fetch() (headers available) but then
  // stalls the BODY must not let the gate believe the slot is free. gatedFetch reads the
  // body inside the same gated task as the fetch — this is the property that closes the
  // gap where a real open connection could exceed the gate's limit while the gate itself
  // believes it is idle, and directly exercises the same read that http.ts's requestOnce
  // relies on gatedFetch to do.
  //
  // The ground-truth signal here is whether the SECOND caller's own fetch() is reached at
  // all — not whether gatedFetch's outer promise has resolved. A version that reads the
  // body OUTSIDE the gated task still ends up awaiting that same stalled body before ITS
  // OWN promise resolves, so checking gatedFetch's return value can't tell the two apart;
  // only the gate's internal slot-release timing can, and fetchCallCount observes that
  // directly.
  const clock = createFakeClock()
  const gate = createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: 1_000_000, clock })
  let fetchCallCount = 0
  let resolveText!: (value: string) => void
  const textPromise = new Promise<string>((resolve) => {
    resolveText = resolve
  })
  const restoreFetch = stubFetch(async () => {
    fetchCallCount++
    return {
      status: 200,
      ok: true,
      headers: new Headers(),
      text: () => textPromise,
    } as unknown as Response
  })

  const firstPromise = gatedFetch('https://example.test/stall', {}, gate)
  await flushMicrotasks()
  assertEqual(fetchCallCount, 1, 'gatedFetch: the first call reaches fetch()')

  const secondPromise = gatedFetch('https://example.test/second', {}, gate)
  await flushMicrotasks()
  assertEqual(
    fetchCallCount,
    1,
    "gatedFetch: reads the body inside the slot — a queued second caller's fetch() is not reached while the first call's body is still stalled, headers having already arrived",
  )

  resolveText('the body')
  const first = await firstPromise
  assertEqual(first.text, 'the body', 'gatedFetch: the resolved result carries the body read inside the gated task')

  await drainUntil(
    "headers-then-stall probe: waiting for the second caller's fetch()",
    () => fetchCallCount === 2,
    () => flushMicrotasks(),
  )
  assertEqual(fetchCallCount, 2, "gatedFetch: the slot is released once the first call's body finally resolves, admitting the queued second caller")
  await secondPromise
  restoreFetch()
}

{
  // Releases on both success and failure: a rejecting fetch() must free the slot exactly
  // like a resolving one does, not hold it hostage for the next queued caller.
  const clock = createFakeClock()
  const gate = createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: 1_000_000, clock })
  const failure = new Error('network exploded')
  const restoreFailingFetch = stubFetch(() => {
    throw failure
  })

  let caught: unknown
  try {
    await gatedFetch('https://example.test/fail', {}, gate)
  } catch (error) {
    caught = error
  }
  assert(caught === failure, "gatedFetch: propagates a rejecting fetch()'s error unchanged")
  restoreFailingFetch()

  const restoreOkFetch = stubFetch(async () => new Response('ok', { status: 200 }))
  const next = await gatedFetch('https://example.test/next', {}, gate)
  assert(
    next.ok,
    'gatedFetch: releases its slot on failure — the next call (limit=1) is admitted right away instead of hanging behind the failed one',
  )
  restoreOkFetch()
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
