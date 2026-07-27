import { AsyncLocalStorage } from 'node:async_hooks'

// A gate for callers that arrive at unpredictable times over an unbounded lifetime — not a
// batch runner over a known list (that's with-limit.ts, which stays a separate primitive
// and is untouched by this file; see its own doc comment). A gate needs persistent shared
// state across every call, a fairness policy for whoever is waiting right now, and
// cancellation — none of which with-limit.ts's per-call cursor has any use for.
//
// Bounds three things at once: how many tasks may run concurrently, how soon after the
// PREVIOUS task started the next one may start, and how long any single task may run
// before it is treated as hung. All three share one FIFO queue, so a caller that arrives
// later can never be admitted ahead of one already waiting.

export class RequestGateTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`request-gate: task exceeded its ${timeoutMs}ms timeout`)
    this.name = 'RequestGateTimeoutError'
  }
}

export class RequestGateCancelledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RequestGateCancelledError'
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
  // `task` receives an AbortSignal that fires when this call's timeout elapses (combined
  // with the caller's own `signal`, if given), so a real fetch can actually tear its
  // connection down rather than finish unobserved in the background.
  run<T>(task: (signal: AbortSignal) => Promise<T>, options?: { signal?: AbortSignal }): Promise<T>
}

export function createRequestGate(options: RequestGateOptions): RequestGate {
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
  const clock = options.clock ?? systemClock

  // Marks the async context of a task that currently holds a slot. A gate.run() called
  // from inside another gate.run()'s task sees this and skips queueing for a second slot —
  // without it, that pattern deadlocks the moment the limit is exhausted: the outer call
  // holds the only slot while waiting on the inner call, which then waits forever for a
  // slot the outer call cannot release until the inner one finishes. This is sound as long
  // as the holder stays sequential (awaits the nested call rather than racing several in
  // parallel): the outer call isn't doing any IO of its own while the inner one runs, so
  // one physical connection is in flight where the accounting also says one is. A holder
  // that fans nested calls out in parallel (e.g. Promise.all of several gate.run() calls
  // from the same held context) would let true concurrency exceed `limit` — nothing in the
  // codebase does that today, but it is a real limit of this escape hatch, not a solved case.
  const holdingSlot = new AsyncLocalStorage<boolean>()

  let activeCount = 0
  let lastStartTime: number | null = null
  let spacingTimerCancel: (() => void) | null = null

  type Waiter = {
    resolve: () => void
    reject: (error: unknown) => void
    cleanup: () => void
  }
  const queue: Waiter[] = []

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
      const waiter = queue.shift()!
      waiter.cleanup()
      activeCount++
      lastStartTime = now
      waiter.resolve()
    }
  }

  function enqueue(signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, cleanup: () => {} }
      if (signal) {
        const onAbort = (): void => {
          const index = queue.indexOf(waiter)
          // Not found means it was already admitted (popped off the queue by pump()) —
          // cancelling a running task is that task's own concern via the signal it was
          // handed, not this queue's, so there is nothing left here to do.
          if (index === -1) return
          queue.splice(index, 1)
          reject(new RequestGateCancelledError('request-gate: cancelled while waiting in the queue'))
        }
        signal.addEventListener('abort', onAbort)
        waiter.cleanup = () => signal.removeEventListener('abort', onAbort)
      }
      queue.push(waiter)
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
  // hard ceiling rather than a polite request.
  function runWithTimeout<T>(task: (signal: AbortSignal) => Promise<T>, callerSignal: AbortSignal | undefined): Promise<T> {
    const timeoutController = new AbortController()
    const combinedSignal = callerSignal ? AbortSignal.any([callerSignal, timeoutController.signal]) : timeoutController.signal

    return new Promise<T>((resolve, reject) => {
      let settled = false
      const cancelTimer = clock.setTimer(timeoutMs, () => {
        if (settled) return
        settled = true
        timeoutController.abort()
        reject(new RequestGateTimeoutError(timeoutMs))
      })
      Promise.resolve(task(combinedSignal)).then(
        (value) => {
          if (settled) return
          settled = true
          cancelTimer()
          resolve(value)
        },
        (error: unknown) => {
          if (settled) return
          settled = true
          cancelTimer()
          reject(error)
        },
      )
    })
  }

  async function run<T>(task: (signal: AbortSignal) => Promise<T>, opts: { signal?: AbortSignal } = {}): Promise<T> {
    const { signal } = opts
    if (signal?.aborted) throw new RequestGateCancelledError('request-gate: cancelled before starting')

    const consumesSlot = holdingSlot.getStore() !== true
    if (consumesSlot) await enqueue(signal)

    try {
      return await holdingSlot.run(true, () => runWithTimeout(task, signal))
    } finally {
      // A slot is only ever taken in the branch that took it — releasing unconditionally
      // here would let a reentrant call, which never incremented activeCount, decrement it
      // anyway and desync the count from reality.
      if (consumesSlot) release()
    }
  }

  return { run }
}
