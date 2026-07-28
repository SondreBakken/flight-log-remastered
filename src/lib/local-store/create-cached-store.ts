// No 'use client' directive here, deliberately. This module touches window.localStorage, but it
// is only ever imported by modules that already declare that boundary, so it inherits theirs.
// Declaring its own would make this file a client entry point, and Next.js then reads the
// exported config type's function fields (parse, serialize, equal, describeOversized) as
// component props that ought to be serializable, which they are not and are not meant to be.
// Every call is guarded by `typeof window === 'undefined'` regardless.

// The storage half that watermark-store and seen-trip-store had written out separately. #65
// measured them at 45 of 78 identical lines, more alike than either is to follow-store, and
// the parts that differ are exactly the six below: what the stored value is, how it parses and
// serializes, when two values count as equal, what an empty one looks like, which key it lives
// under, and what to say when it outgrows the limit.
//
// The argument for sharing was never line count. It is that the identical parts are the ones
// that keep being got wrong, and getting them wrong is invisible: #5's review found six
// mutations surviving in watermark-store's check script that its own model caught, because the
// copy inherited the code and not the proof. Its oversized fixture used a repeated character
// that is not a valid value, so the payload was rejected for being INVALID rather than for
// being OVERSIZED, and the length guard was never exercised at all. One adapter is one place
// for those guards to be proven.
//
// Deliberately not applied to follow-store: it carries a useSyncExternalStore surface
// (subscribe, snapshot, notify) that these two dropped because nothing reads them reactively.
// Folding that in would mean parameterising the reactive layer too, which is a larger change
// than the duplication it would remove.
export type StoredRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false }

export type CachedStoreConfig<T> = {
  readonly storageKey: string
  readonly empty: T
  readonly parse: (raw: string | null) => StoredRead<T>
  readonly serialize: (value: T) => string
  readonly equal: (a: T, b: T) => boolean
  readonly maxRawLength: number
  // Called only when a write is skipped for length. Takes the value so the message can describe
  // what actually outgrew the limit (how many pilots, how many ids) rather than a bare count.
  readonly describeOversized: (value: T, limit: number) => string
}

export type CachedStore<T> = {
  // The cached value, hydrating from storage on first call. Reads are plain calls rather than a
  // hook because both consumers read once at a known moment in a fetch lifecycle, and need that
  // read to happen BEFORE the write that follows it in the same load.
  readonly current: () => T
  // Writes only when the value actually changed, so a no-op write never touches localStorage and
  // never fires a storage event in another tab.
  readonly commit: (next: T) => void
}

export function createCachedStore<T>(config: CachedStoreConfig<T>): CachedStore<T> {
  let hydrated = false
  let value: T = config.empty

  function read(): StoredRead<T> {
    if (typeof window === 'undefined') return { ok: false }
    try {
      return config.parse(window.localStorage.getItem(config.storageKey))
    } catch {
      // Safari private mode and disabled storage throw on access.
      return { ok: false }
    }
  }

  function write(next: T): void {
    if (typeof window === 'undefined') return
    const serialized = config.serialize(next)
    // A payload past the limit would fail to parse on the next load anyway, so skip persisting
    // it rather than silently lose the whole value. The in-memory value still updates for this
    // tab; only durability across reloads is given up.
    if (serialized.length > config.maxRawLength) {
      console.warn(config.describeOversized(next, config.maxRawLength))
      return
    }
    try {
      window.localStorage.setItem(config.storageKey, serialized)
    } catch {
      // Storage can be unavailable or full; the in-memory value still updates for this tab.
    }
  }

  function current(): T {
    if (!hydrated) {
      const result = read()
      value = result.ok ? result.value : config.empty
      hydrated = true
    }
    return value
  }

  function commit(next: T): void {
    const previous = current()
    if (config.equal(next, previous)) return
    value = next
    write(next)
  }

  // Another tab writing the same key is the only external change worth reacting to. Both
  // consumers read this cache rather than localStorage directly, so without this a stale cache
  // in one tab could derive its next value from data another tab has already moved past, and
  // write that regression back. This refreshes the cache only; there is no subscriber list.
  //
  // `event.key === null` means another tab called localStorage.clear(), which clears our key
  // too, so it must not be filtered out.
  function handleStorageEvent(event: StorageEvent): void {
    if (event.key !== null && event.key !== config.storageKey) return
    const result = read()
    if (!result.ok) return
    if (config.equal(result.value, value)) return
    value = result.value
    hydrated = true
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorageEvent)
  }

  return { current, commit }
}
