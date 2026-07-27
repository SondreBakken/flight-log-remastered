import { inspect } from 'node:util'
import {
  createRequestGate,
  RequestGateCancelledError,
  RequestGateTimeoutError,
  type GateClock,
} from '../src/lib/concurrency/request-gate'
import {
  REQUEST_GATE_LIMIT,
  REQUEST_GATE_MIN_SPACING_MS,
  REQUEST_GATE_TIMEOUT_MS,
} from '../src/lib/flightlog/request-gate'
import { CONCURRENCY_LIMIT } from '../src/features/browse-flight-feed/use-flight-feed'
import { MAX_YEARS_PER_PILOT } from '../src/features/browse-flight-feed/feed'

// Real (not fake-clock) watchdog: a mutation that removes the timeout entirely makes the
// hung-task assertion below await a promise that never settles — real code, not the fake
// clock, is what would otherwise hang this process forever. This is independent of the
// fake clock (it uses the real event loop), so it fires even while a `run()` call is
// genuinely stuck, and stays inert on every normal run, which finishes in milliseconds.
const watchdog = setTimeout(() => {
  console.error('FAIL - watchdog: check-request-gate.mts did not finish within 5s (likely a deadlock introduced by a mutation)')
  process.exit(1)
}, 5000)

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

type FakeClock = GateClock & { advance(ms: number): Promise<void> }

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
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

const DEADLOCK_SENTINEL = Symbol('deadlock')

// Guards a test against an actual hang: races the promise under test against a bounded
// number of microtask ticks. A correct gate settles within a handful of ticks (no real
// waiting is involved once time is fixed), so hitting the tick budget means the call never
// settles — the exact shape a real deadlock takes — and the test fails loudly instead of
// hanging the whole check run forever.
function raceAgainstMicrotaskDeadline<T>(promise: Promise<T>, ticks = 500): Promise<T | typeof DEADLOCK_SENTINEL> {
  const sentinel = new Promise<typeof DEADLOCK_SENTINEL>((resolve) => {
    let i = 0
    const tick = (): void => {
      i++
      if (i >= ticks) resolve(DEADLOCK_SENTINEL)
      else void Promise.resolve().then(tick)
    }
    void Promise.resolve().then(tick)
  })
  return Promise.race([promise, sentinel])
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
// Cancellation of a caller still waiting in the queue must not consume a slot.
// =====================================================================================

{
  const clock = createFakeClock()
  const gate = createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: 1_000_000, clock })
  const harness = makeHarness(3)
  const controllerForSecond = new AbortController()

  const first = gate.run(harness.runFns[0]!) // holds the only slot
  await flushMicrotasks()
  const second = gate.run(harness.runFns[1]!, { signal: controllerForSecond.signal }) // queues
  const third = gate.run(harness.runFns[2]!) // queues behind `second`
  await flushMicrotasks()
  assertEqual(harness.startedCount(), 1, 'cancellation: only the first caller has started; the second and third are queued')

  controllerForSecond.abort()
  let secondError: unknown
  try {
    await second
  } catch (error) {
    secondError = error
  }
  assert(secondError instanceof RequestGateCancelledError, 'cancellation: the cancelled queued caller rejects with a distinguishable RequestGateCancelledError')
  assert(!harness.startOrder.includes(1), 'cancellation: the cancelled caller\'s task never runs at all')

  // Releasing the held slot now must hand it straight to the third caller — proof the
  // cancelled second caller never occupied (or is still holding onto) a slot of its own.
  harness.releaseOldest()
  await flushMicrotasks()
  assert(harness.startOrder.includes(2), 'cancellation: the slot freed by the first caller goes straight to the third — the cancelled one did not leak a phantom slot')

  harness.releaseOldest()
  await flushMicrotasks()
  await Promise.all([first, third])
  assertEqual(harness.startOrder, [0, 2], 'cancellation: exactly the two non-cancelled callers ever ran, in order')
}

{
  // A signal already aborted before the call is even made must reject immediately, without
  // ever touching the queue or the task.
  const clock = createFakeClock()
  const gate = createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: 1000, clock })
  const controller = new AbortController()
  controller.abort()
  const t = makeControlledTask()
  let caught: unknown
  try {
    await gate.run(t.task, { signal: controller.signal })
  } catch (error) {
    caught = error
  }
  assert(caught instanceof RequestGateCancelledError, 'cancellation: a signal aborted before the call starts rejects immediately with RequestGateCancelledError')
  assert(!t.started(), 'cancellation: the task is never invoked when the signal was already aborted')
}

// =====================================================================================
// Reentrancy: a gated call made from inside another gated call must not deadlock, even
// with a limit as tight as 1.
// =====================================================================================

{
  const clock = createFakeClock()
  const gate = createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: 1_000_000, clock })
  let innerRan = false

  const outerPromise = gate.run(async () => {
    const innerResult = await gate.run(async () => {
      innerRan = true
      return 'inner'
    })
    return `outer-${innerResult}`
  })

  const raced = await raceAgainstMicrotaskDeadline(outerPromise)
  assert(raced !== DEADLOCK_SENTINEL, 'reentrancy: a gate.run() nested inside another gate.run(), with limit=1, does not deadlock')
  if (raced !== DEADLOCK_SENTINEL) {
    assertEqual(raced, 'outer-inner', 'reentrancy: the nested call\'s result threads through to the outer call correctly')
  }
  assert(innerRan, 'reentrancy: the inner task actually ran, rather than the outer call short-circuiting around it')
}

{
  // The nested call is admitted for free (it does not need a second slot of its own,
  // since the outer call already holds the only one) — but it must not leak extra
  // capacity to an UNRELATED caller that is not part of the nested chain.
  const clock = createFakeClock()
  const gate = createRequestGate({ limit: 1, minSpacingMs: 0, timeoutMs: 1_000_000, clock })
  const inner = makeControlledTask()
  const other = makeControlledTask()

  const outerPromise = gate.run(async () => {
    const innerResult = await gate.run(inner.task)
    return `outer-${innerResult}`
  })
  const otherPromise = gate.run(other.task)

  await flushMicrotasks()
  assert(inner.started(), 'reentrancy: the nested call is admitted immediately even though the outer call already holds the only slot')
  assert(!other.started(), 'reentrancy: a separate, non-nested caller still queues behind the held slot — the nested call does not free capacity for unrelated callers')

  inner.resolve('done')
  const racedOuter = await raceAgainstMicrotaskDeadline(outerPromise)
  assert(racedOuter !== DEADLOCK_SENTINEL, 'reentrancy: the outer call completes once its nested call resolves')
  assertEqual(racedOuter, 'outer-done', 'reentrancy: outer result reflects the resolved nested call')

  await flushMicrotasks()
  assert(other.started(), 'reentrancy: only once the outer call (and its nested call) fully releases the slot does the unrelated queued caller start')
  other.resolve('other-done')
  assertEqual(await otherPromise, 'other-done', 'reentrancy: the unrelated caller still completes normally afterwards')
}

clearTimeout(watchdog)
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
