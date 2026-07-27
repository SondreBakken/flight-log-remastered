// A worker-pool limiter: `limit` workers pull the next item off a shared cursor until
// none remain, so at most `limit` calls to `run` are ever in flight at once — domain
// agnostic, no knowledge of what `run` does. Used by the flight feed to bound how many
// per-pilot requests fire at once (see docs/flightlog-api.md on flightlog.org's traffic
// pattern detection), but nothing here is specific to that caller.
//
// `onSettled` fires as each item finishes, in COMPLETION order rather than input order,
// so a caller can render results incrementally instead of waiting for every item to land.
//
// A rejected `run` never propagates past this function: it is delivered to `onSettled` as
// a settled outcome, same as a fulfilled one, so one failing item can neither vanish nor
// abort the workers still draining the rest of the queue. This is a shared `src/lib/`
// utility (see its own reuse in getTrackedTripIds), so it must be safe for a caller that
// never wraps the call in try/catch of its own.
export type Settled<R> = { readonly ok: true; readonly value: R } | { readonly ok: false; readonly error: unknown }

async function settle<T, R>(item: T, run: (item: T) => Promise<R>): Promise<Settled<R>> {
  try {
    return { ok: true, value: await run(item) }
  } catch (error) {
    return { ok: false, error }
  }
}

export async function runWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
  onSettled: (item: T, result: Settled<R>) => void,
): Promise<void> {
  // A non-positive or non-integer limit (including NaN, which fails every comparison) must
  // fail loudly: `Math.max(1, Math.min(limit, n))` used to silently coerce it into either 1
  // worker or, for NaN specifically, zero workers — a limiter that quietly does nothing is
  // worse than one that throws, because nothing downstream observes the difference between
  // "ran with an empty pool" and "ran normally with no items".
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError(`runWithConcurrencyLimit: limit must be a positive integer, got ${limit}`)
  }

  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++]
      const outcome = await settle(item, run)
      try {
        onSettled(item, outcome)
      } catch (error) {
        // A throwing callback is caller code, not a limiter failure: swallowing it here
        // (rather than letting it reject this worker's Promise.all branch) is what keeps
        // the other workers draining the rest of the queue instead of the pool detaching —
        // surviving workers finishing after Promise.all already rejected on this one.
        console.error('runWithConcurrencyLimit: onSettled threw', error)
      }
    }
  }

  const workerCount = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
}
