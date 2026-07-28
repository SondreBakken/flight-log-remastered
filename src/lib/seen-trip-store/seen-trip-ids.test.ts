import { describe, expect, it } from 'vitest'
import {
  parseStoredSeenTrips,
  removeSeenTripIds,
  replaceSeenTripIds,
  serializeSeenTrips,
  STORED_RAW_MAX_LENGTH,
} from './seen-trip-ids'

// A string past the length guard that also happens to be invalid JSON (or whose entries are
// individually invalid for a reason OTHER than length) would be a false-positive fixture: it
// fails to parse regardless of whether the length guard exists. Every entry here is a real
// pilot id mapped to a real, single-element array of a valid trip id — this payload is
// rejected ONLY because of its length, so it actually exercises STORED_RAW_MAX_LENGTH rather
// than some other rejection path.
function oversizedValidSeenTripsPayload(): string {
  const entries = Object.fromEntries(Array.from({ length: 1_700 }, (_, index) => [100_000 + index, [1]]))
  const raw = JSON.stringify(entries)
  if (raw.length <= STORED_RAW_MAX_LENGTH) throw new Error('fixture too small to exceed STORED_RAW_MAX_LENGTH')
  return raw
}

describe('parseStoredSeenTrips / serializeSeenTrips', () => {
  it('round-trips a valid seen-trips map through serialize then parse', () => {
    const original = new Map<number, ReadonlySet<number>>([
      [4549, new Set([100, 200, 300])],
      [12677, new Set([500])],
    ])
    const result = parseStoredSeenTrips(serializeSeenTrips(original))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.seenTripIdsByPilot.size).toBe(2)
    expect([...(result.seenTripIdsByPilot.get(4549) ?? [])].sort()).toEqual([100, 200, 300])
    expect([...(result.seenTripIdsByPilot.get(12677) ?? [])]).toEqual([500])
  })

  it('a genuinely empty object is a successful read with an empty map, not a failed one', () => {
    const result = parseStoredSeenTrips('{}')
    expect(result).toEqual({ ok: true, seenTripIdsByPilot: new Map() })
  })

  it.each([
    ['a null raw value', null],
    ['invalid JSON', 'not json'],
    ['a bare JSON string', '"991729"'],
    ['a bare JSON number', '42'],
  ])('rejects %s rather than crashing', (_label, raw) => {
    expect(parseStoredSeenTrips(raw)).toEqual({ ok: false })
  })

  it('rejects a JSON array specifically because it is an array, not because its "entries" happen to be invalid — pins Array.isArray(parsed), not the all-entries-invalid fallback', () => {
    // Object.entries([[1],[2]]) yields index-keyed entries: key '0' and '1' are both valid
    // pilot ids, and each value is a genuinely valid (non-empty, all-valid-trip-id) array. If
    // the reader ever stopped checking Array.isArray and fell through to the same entry-by-
    // entry validation an object payload gets, THIS array would wrongly parse to a successful,
    // non-empty read instead of being rejected outright for being an array at all.
    expect(parseStoredSeenTrips('[[1],[2]]')).toEqual({ ok: false })
  })

  it('rejects a payload past the length guard, even if it is otherwise entirely valid — every entry here is a real pilot id mapped to a real trip id, so this can only fail on length', () => {
    expect(parseStoredSeenTrips(oversizedValidSeenTripsPayload())).toEqual({ ok: false })
  })

  it('drops a trip id past Number.MAX_SAFE_INTEGER even though it is a whole number — pins Number.isSafeInteger, not Number.isInteger (RED if the validator swaps to isInteger, since 2**53+4 is exactly representable as a float and would then wrongly pass)', () => {
    const unsafeButWholeTripId = 2 ** 53 + 4
    const raw = JSON.stringify({ 4549: [500, unsafeButWholeTripId] })
    const result = parseStoredSeenTrips(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...(result.seenTripIdsByPilot.get(4549) ?? [])]).toEqual([500])
  })

  it('an entry with an invalid pilot id, a non-array value, or an array of invalid trip ids is dropped, but a valid entry alongside it still succeeds', () => {
    const raw = JSON.stringify({
      '-1': [1, 2], // invalid pilot id
      abc: [1, 2], // invalid pilot id (NaN)
      4549: 'not-an-array', // value is not an array at all
      9001: [-1, 0, 'x'], // array, but every element is an invalid trip id
      12677: [500, 600],
    })
    const result = parseStoredSeenTrips(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...result.seenTripIdsByPilot.entries()].map(([pilotId, ids]) => [pilotId, [...ids]])).toEqual([
      [12677, [500, 600]],
    ])
  })

  it('a trip-id array with SOME invalid elements keeps only the valid ones, rather than dropping the whole entry', () => {
    const raw = JSON.stringify({ 4549: [500, -1, 'garbage', 600, null] })
    const result = parseStoredSeenTrips(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...(result.seenTripIdsByPilot.get(4549) ?? [])].sort((a, b) => a - b)).toEqual([500, 600])
  })

  it('a non-empty object where every entry fails validation is a failed read, not a successful empty one — otherwise a schema drift silently reads back as "nobody has seen anything yet"', () => {
    const raw = JSON.stringify({ '-1': [1], abc: [1] })
    expect(parseStoredSeenTrips(raw)).toEqual({ ok: false })
  })
})

describe('removeSeenTripIds', () => {
  it('removeSeenTripIds drops a pilot entirely', () => {
    const before = new Map<number, ReadonlySet<number>>([
      [4549, new Set([1, 2])],
      [12677, new Set([3])],
    ])
    expect(removeSeenTripIds(before, 4549)).toEqual(new Map([[12677, new Set([3])]]))
  })

  it('removeSeenTripIds on a pilot with no stored entry is a no-op', () => {
    const before = new Map<number, ReadonlySet<number>>([[4549, new Set([1])]])
    expect(removeSeenTripIds(before, 999)).toEqual(before)
  })
})

describe('replaceSeenTripIds — the replace-vs-union rule (#62)', () => {
  it('sets an initial entry for a pilot with none stored yet, from whatever rendered this load', () => {
    const result = replaceSeenTripIds(new Map(), 4549, new Set([100, 200]), new Set([100]))
    expect(result.get(4549)).toEqual(new Set([100]))
  })

  it('is NOT a pure replace: an id shown on a PREVIOUS load, still within this load\'s fetched scope but NOT rendered this load, survives — a pure-replace mutant (next = renderedTripIds only) would drop it', () => {
    const before = new Map<number, ReadonlySet<number>>([[4549, new Set([100, 200])]])
    // 100 and 200 are both still fetched this load (still in scope), but only 300 rendered —
    // 100/200 were crowded out of the merged feed this time, not forgotten by the pilot.
    const result = replaceSeenTripIds(before, 4549, new Set([100, 200, 300]), new Set([300]))
    expect(result.get(4549)).toEqual(new Set([100, 200, 300]))
  })

  it('is NOT a pure union: an id that has aged OUT of this load\'s fetched scope is dropped — a pure-union mutant (next = previous ∪ rendered, ignoring fetchedTripIds) would keep it forever', () => {
    const before = new Map<number, ReadonlySet<number>>([[4549, new Set([100, 999])]])
    // 999 is no longer in this pilot's fetched scope at all (fallen out of their
    // RECENT_FLIGHTS_PER_PILOT window) — it must not survive, unlike a pure union which
    // would carry it forward unconditionally.
    const result = replaceSeenTripIds(before, 4549, new Set([100, 300]), new Set([300]))
    expect(result.get(4549)).toEqual(new Set([100, 300]))
    expect(result.get(4549)?.has(999)).toBe(false)
  })

  it('the result is always bounded by fetchedTripIds, never larger — even when previous + rendered together would exceed it', () => {
    const before = new Map<number, ReadonlySet<number>>([[4549, new Set([1, 2, 3, 4, 5])]])
    const fetched = new Set([3, 4, 5]) // only 3 ids still in scope this load
    const result = replaceSeenTripIds(before, 4549, fetched, new Set([5]))
    expect(result.get(4549)?.size).toBeLessThanOrEqual(fetched.size)
    expect(result.get(4549)).toEqual(new Set([3, 4, 5]))
  })

  it('a pilot who renders nothing new and has nothing left in scope from before is removed from the map entirely, not left as an empty set', () => {
    const before = new Map<number, ReadonlySet<number>>([[4549, new Set([999])]])
    const result = replaceSeenTripIds(before, 4549, new Set([100]), new Set())
    expect(result.has(4549)).toBe(false)
  })

  it('does not mutate the input map — a fresh Map is returned', () => {
    const before = new Map<number, ReadonlySet<number>>([[4549, new Set([1])]])
    const result = replaceSeenTripIds(before, 4549, new Set([1, 2]), new Set([2]))
    expect(before.get(4549)).toEqual(new Set([1]))
    expect(result).not.toBe(before)
  })

  it('rejects an invalid pilot id, leaving the map unchanged', () => {
    const before = new Map<number, ReadonlySet<number>>([[4549, new Set([1])]])
    expect(replaceSeenTripIds(before, -1, new Set([1]), new Set([1]))).toEqual(before)
  })

  it('leaves OTHER pilots entirely untouched', () => {
    const before = new Map<number, ReadonlySet<number>>([
      [4549, new Set([1])],
      [12677, new Set([2])],
    ])
    const result = replaceSeenTripIds(before, 4549, new Set([1, 3]), new Set([3]))
    expect(result.get(12677)).toEqual(new Set([2]))
  })
})
