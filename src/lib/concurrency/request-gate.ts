// A gate for callers that arrive at unpredictable times over an unbounded lifetime — not a
// batch runner over a known list (that's with-limit.ts, which stays a separate primitive
// and is untouched by this file; see its own doc comment). A gate needs persistent shared
// state across every call and a fairness policy for whoever is waiting right now, neither
// of which with-limit.ts's per-call cursor has any use for.
//
// Bounds three things at once: how many tasks may run concurrently, how soon after the
// PREVIOUS task started the next one may start, and how long any single task may run
// before it is treated as hung. All three share one FIFO queue, so a caller that arrives
// later can never be admitted ahead of one already waiting.
//
// Every caller consumes a slot of the shared pool — a task calling back into this same
// gate deadlocks once the limit is exhausted, since the outer call would hold the only
// slot while waiting on an inner call that can never be admitted. Nothing in this codebase
// does that today (see flightlog/outbound-gate.ts's callers), so this stays unhandled
// rather than adding a mechanism for a shape that doesn't exist.

export class RequestGateTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`request-gate: task exceeded its ${timeoutMs}ms timeout`)
    this.name = 'RequestGateTimeoutError'
  }
}

// Injectable so tests can drive time and timer firing deterministically instead of via
// real sleeps — see scripts/check-request-gate.mts's fake clock, which never actually
// waits, only advances a virtual clock and fires due timers in order.
export type GateClock = {
  now(): number
  setTimer(ms: number, callback: () => void): () => void
}

const systemClock: GateClock = {
  now: () => Date.now(),
  setTimer: (ms, callback) => {
    const handle = setTimeout(callback, ms)
    return () => clearTimeout(handle)
  },
}

export type RequestGateOptions = {
  readonly limit: number
  readonly minSpacingMs: number
  readonly timeoutMs: number
  readonly clock?: GateClock
}

export type RequestGate = {
  // `task` receives an AbortSignal that fires when this call's timeout elapses, so a real
  // fetch can actually tear its connection down rather than finish unobserved in the
  // background.
  run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}

function assertValidOptions(options: RequestGateOptions): void {
  const { limit, minSpacingMs, timeoutMs } = options
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError(`createRequestGate: limit must be a positive integer, got ${limit}`)
  }
  if (!Number.isFinite(minSpacingMs) || minSpacingMs < 0) {
    throw new RangeError(`createRequestGate: minSpacingMs must be >= 0, got ${minSpacingMs}`)
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`createRequestGate: timeoutMs must be a positive number, got ${timeoutMs}`)
  }
}

export function createRequestGate(options: RequestGateOptions): RequestGate {
  assertValidOptions(options)
  const { limit, minSpacingMs, timeoutMs } = options
  const clock = options.clock ?? systemClock

  let activeCount = 0
  let lastStartTime: number | null = null
  let spacingTimerCancel: (() => void) | null = null

  const queue: Array<() => void> = []

  function scheduleSpacingWakeup(delayMs: number): void {
    spacingTimerCancel?.()
    spacingTimerCancel = clock.setTimer(delayMs, () => {
      spacingTimerCancel = null
      pump()
    })
  }

  // The only place admission decisions are made, invoked whenever something that could
  // change the answer happens: a waiter joins, a slot frees up, or a spacing delay elapses.
  // Always pulls from the front of the queue — what makes ordering FIFO, since a waiter
  // that joins later can only ever be examined after everyone ahead of it has been admitted.
  function pump(): void {
    while (queue.length > 0 && activeCount < limit) {
      const now = clock.now()
      const earliestStart = lastStartTime === null ? now : lastStartTime + minSpacingMs
      if (now < earliestStart) {
        scheduleSpacingWakeup(earliestStart - now)
        return
      }
      const admit = queue.shift()!
      activeCount++
      lastStartTime = now
      admit()
    }
  }

  function enqueue(): Promise<void> {
    return new Promise<void>((resolve) => {
      queue.push(resolve)
      pump()
    })
  }

  function release(): void {
    activeCount--
    pump()
  }

  // Races the task against the timeout rather than trusting the task to honour the abort
  // signal it was handed — a real fetch() does abort promptly, but this also has to be
  // correct for a task that ignores the signal entirely, which is what makes the timeout a
  // hard ceiling rather than a polite request. No `settled` guard is needed: Promise
  // resolution and AbortController.abort()/clearTimeout are already idempotent, so a
  // same-tick race between the two branches (impossible under JS's run-to-completion
  // semantics anyway) would still resolve safely.
  function runWithTimeout<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const timeoutController = new AbortController()

    return new Promise<T>((resolve, reject) => {
      const cancelTimer = clock.setTimer(timeoutMs, () => {
        timeoutController.abort()
        reject(new RequestGateTimeoutError(timeoutMs))
      })
      // Calling task() from inside a .then() rather than bare defers the call by a
      // microtask, which is what routes a SYNCHRONOUS throw (before the task ever returns
      // a promise) into the rejection branch below instead of skipping past cancelTimer()
      // entirely — a bare call's synchronous throw unwinds straight out of this executor,
      // which still rejects the outer promise correctly, but leaves the timeout timer set
      // moments earlier with nothing left to cancel it.
      Promise.resolve()
        .then(() => task(timeoutController.signal))
        .then(
          (value) => {
            cancelTimer()
            resolve(value)
          },
          (error: unknown) => {
            cancelTimer()
            reject(error)
          },
        )
    })
  }

  async function run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    await enqueue()
    try {
      return await runWithTimeout(task)
    } finally {
      release()
    }
  }

  return { run }
}
