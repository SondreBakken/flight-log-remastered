// Builds a Record<K, V> by computing each value from its key, given an exhaustive source
// record to enumerate the keys from. `Object.fromEntries` cannot do this on its own: it
// always types as `Record<string, V>`, so recovering `Record<K, V>` from its result needs an
// `as` cast that TypeScript cannot actually verify — nothing stops that cast from claiming a
// key was written that never was. This centralises that one unavoidable cast here, justified
// once: `source` being `Record<K, unknown>` is itself something TypeScript already forces to
// be exhaustive over `K` wherever it's constructed, so iterating its own keys can never miss
// one, and can never silently pick up an unrelated one either.
export function buildRecord<K extends string, V>(source: Record<K, unknown>, build: (key: K) => V): Record<K, V> {
  const result = {} as Record<K, V>
  for (const key of Object.keys(source) as K[]) {
    result[key] = build(key)
  }
  return result
}
