import { describe, expect, it } from 'vitest'
import {
  advanceWatermark,
  isValidTimestamp,
  parseStoredWatermarks,
  removeWatermark,
  serializeWatermarks,
  STORED_RAW_MAX_LENGTH,
} from './watermark-ids'

// A string past the length guard that also happens to be invalid JSON (or whose entries are
// individually invalid for a reason OTHER than length) would be a false-positive fixture: it
// fails to parse regardless of whether the length guard exists. Every entry here is a real
// pilot id mapped to a real 14-digit timestamp — this payload is rejected ONLY because of its
// length, so it actually exercises STORED_RAW_MAX_LENGTH rather than some other rejection path.
function oversizedValidWatermarksPayload(): string {
  const entries = Object.fromEntries(
    Array.from({ length: 1_500 }, (_, index) => [100_000 + index, '20260101000000']),
  )
  const raw = JSON.stringify(entries)
  if (raw.length <= STORED_RAW_MAX_LENGTH) throw new Error('fixture too small to exceed STORED_RAW_MAX_LENGTH')
  return raw
}

describe('isValidTimestamp', () => {
  it('accepts a 14-digit YYYYMMDDHHMMSS string', () => {
    expect(isValidTimestamp('20260523164423')).toBe(true)
  })

  it('rejects anything that is not exactly 14 digits', () => {
    expect(isValidTimestamp('2026052316442')).toBe(false) // 13 digits
    expect(isValidTimestamp('202605231644233')).toBe(false) // 15 digits
    expect(isValidTimestamp(20260523164423)).toBe(false) // a number, not a string
    expect(isValidTimestamp('2026-05-23T16:44:23')).toBe(false)
    expect(isValidTimestamp(null)).toBe(false)
    expect(isValidTimestamp(undefined)).toBe(false)
  })
})

describe('parseStoredWatermarks / serializeWatermarks', () => {
  it('round-trips a valid watermark map through serialize then parse', () => {
    const original = new Map([
      [4549, '20260523164423'],
      [12677, '20250128081334'],
    ])
    const result = parseStoredWatermarks(serializeWatermarks(original))
    expect(result.ok).toBe(true)
    expect(result.ok && [...result.watermarks.entries()].sort()).toEqual([...original.entries()].sort())
  })

  it('a genuinely empty object is a successful read with an empty map, not a failed one', () => {
    const result = parseStoredWatermarks('{}')
    expect(result).toEqual({ ok: true, watermarks: new Map() })
  })

  it.each([
    ['a null raw value', null],
    ['invalid JSON', 'not json'],
    ['a bare JSON string', '"20260523164423"'],
    ['a bare JSON number', '42'],
  ])('rejects %s rather than crashing', (_label, raw) => {
    expect(parseStoredWatermarks(raw)).toEqual({ ok: false })
  })

  it('rejects a JSON array specifically because it is an array, not because its "entries" happen to be invalid — pins Array.isArray(parsed), not the all-entries-invalid fallback', () => {
    // Object.entries(['null-value', '20260523164423']) yields index-keyed entries: key '1' is a
    // valid pilot id, and its value is a genuinely valid 14-digit timestamp. If the reader ever
    // stopped checking Array.isArray and fell through to the same entry-by-entry validation an
    // object payload gets, THIS array would wrongly parse to a successful, non-empty read
    // instead of being rejected outright for being an array at all.
    expect(parseStoredWatermarks('[null,"20260523164423"]')).toEqual({ ok: false })
  })

  it('rejects a payload past the length guard, even if it is otherwise entirely valid — every entry here is a real pilot id and a real 14-digit timestamp, so this can only fail on length', () => {
    expect(parseStoredWatermarks(oversizedValidWatermarksPayload())).toEqual({ ok: false })
  })

  it('an entry with an invalid pilot id or malformed timestamp is dropped, but a valid entry alongside it still succeeds', () => {
    const raw = JSON.stringify({ '-1': '20260523164423', abc: '20260523164423', 4549: 'not-a-timestamp', 12677: '20250128081334' })
    const result = parseStoredWatermarks(raw)
    expect(result.ok).toBe(true)
    expect(result.ok && [...result.watermarks.entries()]).toEqual([[12677, '20250128081334']])
  })

  it('a non-empty object where every entry fails validation is a failed read, not a successful empty one — otherwise a schema drift silently reads back as "nobody has been seen yet"', () => {
    const raw = JSON.stringify({ '-1': '20260523164423', abc: 'garbage' })
    expect(parseStoredWatermarks(raw)).toEqual({ ok: false })
  })
})

describe('removeWatermark', () => {
  it('removeWatermark drops a pilot entirely', () => {
    const before = new Map([
      [4549, '20260523164423'],
      [12677, '20250128081334'],
    ])
    expect(removeWatermark(before, 4549)).toEqual(new Map([[12677, '20250128081334']]))
  })

  it('removeWatermark on a pilot with no stored watermark is a no-op', () => {
    const before = new Map([[4549, '20260523164423']])
    expect(removeWatermark(before, 999)).toEqual(before)
  })
})

describe('advanceWatermark — the only place a watermark ever moves forward', () => {
  it('sets an initial watermark for a pilot with none stored yet', () => {
    const result = advanceWatermark(new Map(), 4549, '20260523164423')
    expect(result.get(4549)).toBe('20260523164423')
  })

  it('advances when the candidate is strictly newer than the current watermark', () => {
    const before = new Map([[4549, '20250101000000']])
    const result = advanceWatermark(before, 4549, '20260523164423')
    expect(result.get(4549)).toBe('20260523164423')
  })

  it('does not regress when the candidate is OLDER than the current watermark', () => {
    const before = new Map([[4549, '20260523164423']])
    const result = advanceWatermark(before, 4549, '20250101000000')
    expect(result.get(4549)).toBe('20260523164423')
  })

  // NOT a RED case for `>` vs `>=`: an equal candidate produces a byte-identical map either
  // way (see advanceWatermark's own doc comment), so this cannot distinguish the two operators
  // — it only pins that the resulting VALUE is correct, which a `>=` mutant would also satisfy.
  it('leaves the watermark at the same value when the candidate exactly EQUALS the current one: the ts-boundary rule this store guards is strict, so equal is not treated as an improvement', () => {
    const before = new Map([[4549, '20260523164423']])
    const result = advanceWatermark(before, 4549, '20260523164423')
    expect(result.get(4549)).toBe('20260523164423')
    expect(result).toEqual(before)
  })

  it('rejects an invalid candidate timestamp, leaving the watermark unchanged', () => {
    const before = new Map([[4549, '20260523164423']])
    expect(advanceWatermark(before, 4549, 'garbage')).toEqual(before)
  })
})
