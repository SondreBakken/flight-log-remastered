import { describe, expect, it } from 'vitest'
import {
  advanceWatermark,
  isValidTimestamp,
  parseStoredWatermarks,
  removeWatermark,
  serializeWatermarks,
  setWatermark,
  STORED_RAW_MAX_LENGTH,
} from './watermark-ids'

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
    ['a JSON array (this store is keyed by pilot id, not a list)', '[1,2,3]'],
    ['a bare JSON string', '"20260523164423"'],
    ['a bare JSON number', '42'],
  ])('rejects %s rather than crashing', (_label, raw) => {
    expect(parseStoredWatermarks(raw)).toEqual({ ok: false })
  })

  it('rejects a payload past the length guard, even if it is otherwise valid JSON — the boundary is a corrupt/oversized value being REJECTED, not crashing the reader', () => {
    const hostile = JSON.stringify({ 1: '2'.repeat(STORED_RAW_MAX_LENGTH) })
    expect(hostile.length).toBeGreaterThan(STORED_RAW_MAX_LENGTH)
    expect(parseStoredWatermarks(hostile)).toEqual({ ok: false })
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

describe('setWatermark / removeWatermark', () => {
  it('setWatermark adds a pilot entry', () => {
    const result = setWatermark(new Map(), 4549, '20260523164423')
    expect(result).toEqual(new Map([[4549, '20260523164423']]))
  })

  it('setWatermark rejects an invalid pilot id or timestamp, leaving the map unchanged', () => {
    const before = new Map([[4549, '20260523164423']])
    expect(setWatermark(before, -1, '20260523164423')).toEqual(before)
    expect(setWatermark(before, 4549, 'garbage')).toEqual(before)
  })

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

  it('leaves the watermark unchanged when the candidate exactly EQUALS the current value (RED if the comparison flips from > to >=): the ts-boundary rule this store guards is strict, so equal is not an improvement worth writing', () => {
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
