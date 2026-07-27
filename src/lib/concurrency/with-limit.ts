// A worker-pool limiter: `limit` workers pull the next item off a shared cursor until
// none remain, so at most `limit` calls to `run` are ever in flight at once — domain
// agnostic, no knowledge of what `run` does. Used by the flight feed to bound how many
// per-pilot requests fire at once (see docs/flightlog-api.md on flightlog.org's traffic
// pattern detection), but nothing here is specific to that caller.
//
// `onSettled` fires as each item finishes, in COMPLETION order rather than input order,
// so a caller can render results incrementally instead of waiting for every item to land.
export async function runWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
  onSettled: (item: T, result: R) => void,
): Promise<void> {
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++]
      const result = await run(item)
      onSettled(item, result)
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, worker))
}
