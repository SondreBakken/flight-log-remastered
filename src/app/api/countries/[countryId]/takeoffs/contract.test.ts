import { describe, expect, it } from 'vitest'
import type { Takeoff } from '@/lib/flightlog/types'
import { encodeTakeoffRow, isTakeoffRows, TAKEOFF_ROW_LENGTH, type TakeoffRow } from './contract'

describe('encodeTakeoffRow', () => {
  it('places every field at its fixed position, and nothing else', () => {
    // Every numeric field gets a DISTINCT value (1-9, skipping name) rather than realistic
    // but coincidentally-equal ones (e.g. lat/lon both small decimals) — a swap between any
    // two positions (say wind and regionId) would silently pass a fixture where those two
    // fields happen to share a value, but fails loudly here.
    const takeoff: Takeoff = {
      takeoffId: 1,
      name: 'a',
      lat: 2,
      lon: 3,
      wind: 4,
      countryId: 5,
      regionId: 6,
      subregionId: 7,
      altitude: 8,
      altitudeDiff: 9,
    }

    const row = encodeTakeoffRow(takeoff)

    expect(row).toEqual([1, 'a', 2, 3, 4, 5, 6, 7, 8, 9])
    expect(row).toHaveLength(TAKEOFF_ROW_LENGTH)
  })

  // Values quoted verbatim from fixtures/takeoffs-160.html's row 1: `6246 | Jorde på Løten,
  // Klæpa airport | 60.79527778 | 11.34555556 | 56 | 160 | 6 | 0 | 180 | 0`.
  it('round-trips a real fixture row (Jorde på Løten, takeoff id 6246) field for field', () => {
    const takeoff: Takeoff = {
      takeoffId: 6246,
      name: 'Jorde på Løten, Klæpa airport',
      lat: 60.79527778,
      lon: 11.34555556,
      wind: 56,
      countryId: 160,
      regionId: 6,
      subregionId: 0,
      altitude: 180,
      altitudeDiff: 0,
    }

    expect(encodeTakeoffRow(takeoff)).toEqual([
      6246,
      'Jorde på Løten, Klæpa airport',
      60.79527778,
      11.34555556,
      56,
      160,
      6,
      0,
      180,
      0,
    ])
  })
})

describe('isTakeoffRows', () => {
  const validRow: TakeoffRow = [1, 'a', 2, 3, 4, 5, 6, 7, 8, 9]

  it('accepts an array of well-formed rows', () => {
    expect(isTakeoffRows([validRow, [10, 'b', 20, 30, 40, 50, 60, 70, 80, 90]])).toBe(true)
  })

  it('accepts an empty array (a genuinely takeoff-free country)', () => {
    expect(isTakeoffRows([])).toBe(true)
  })

  it('rejects a non-array response body', () => {
    expect(isTakeoffRows({ rows: [validRow] })).toBe(false)
  })

  it('rejects a row with the wrong length', () => {
    const tooShort = validRow.slice(0, TAKEOFF_ROW_LENGTH - 1)
    expect(isTakeoffRows([tooShort])).toBe(false)
  })

  it('rejects a row with a field of the wrong type at any position', () => {
    for (let position = 0; position < TAKEOFF_ROW_LENGTH; position++) {
      const corrupted = [...validRow]
      corrupted[position] = position === 1 ? 999 : 'not-a-number' // name (index 1) wants a string, everywhere else wants a number
      expect(isTakeoffRows([corrupted])).toBe(false)
    }
  })

  it('rejects the whole array when a LATER row is malformed, not just the first', () => {
    // Guards against an `.every` swapped for `[0]`-only (or dropped entirely) — a mutation
    // that only checks the first row would let this slip through as valid.
    const malformedSecondRow = [1, 'b', 2, 3, 4, 5, 6, 7, 8] // one field short
    expect(isTakeoffRows([validRow, malformedSecondRow])).toBe(false)
  })

  it('rejects a row with lat and altitude swapped, at real Norway-fixture scale', () => {
    // lat=60.8, altitude=180 (Jorde på Løten, fixtures/takeoffs-160.html) — a `typeof ===
    // 'number'` check alone cannot tell these two fields apart in either position, since both
    // are numbers; only the ±90 latitude bound catches 180 landing in lat's slot.
    const correct: TakeoffRow = [6246, 'Jorde på Løten', 60.8, 11.3, 166, 160, 6, 2, 180, -12]
    const swapped = [6246, 'Jorde på Løten', 180, 11.3, 166, 160, 6, 2, 60.8, -12]
    expect(isTakeoffRows([correct])).toBe(true)
    expect(isTakeoffRows([swapped])).toBe(false)
  })

  it('rejects lat/lon outside geographic range and wind outside the confirmed 0-255 bitmask range', () => {
    expect(isTakeoffRows([[1, 'a', 91, 3, 4, 5, 6, 7, 8, 9]])).toBe(false) // lat > 90
    expect(isTakeoffRows([[1, 'a', -91, 3, 4, 5, 6, 7, 8, 9]])).toBe(false) // lat < -90
    expect(isTakeoffRows([[1, 'a', 2, 181, 4, 5, 6, 7, 8, 9]])).toBe(false) // lon > 180
    expect(isTakeoffRows([[1, 'a', 2, -181, 4, 5, 6, 7, 8, 9]])).toBe(false) // lon < -180
    expect(isTakeoffRows([[1, 'a', 2, 3, 256, 5, 6, 7, 8, 9]])).toBe(false) // wind > 255
    expect(isTakeoffRows([[1, 'a', 2, 3, -1, 5, 6, 7, 8, 9]])).toBe(false) // wind < 0
  })

  // wind ends up in windIncludesDirection (see lib/flightlog/wind.ts's assertOctant/
  // assertWindByte), which requires an INTEGER in [0, 255] and throws a RangeError on
  // anything else. Before #12 this never mattered — wind never left decoding — but now a
  // non-integer wind that this check waved through as "in range" would reach that throwing
  // assert from inside a client render, not fail here at the wire boundary where a bad
  // payload belongs.
  it('rejects a non-integer wind, even though it falls within the 0-255 range', () => {
    expect(isTakeoffRows([[1, 'a', 2, 3, 4.5, 5, 6, 7, 8, 9]])).toBe(false)
  })
})
