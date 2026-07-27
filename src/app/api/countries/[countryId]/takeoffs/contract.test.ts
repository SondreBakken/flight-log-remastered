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

  it('round-trips a real fixture row (Jorde på Løten, takeoff id 6246) field for field', () => {
    const takeoff: Takeoff = {
      takeoffId: 6246,
      name: 'Jorde på Løten, Klæpa airport',
      lat: 60.8,
      lon: 11.3,
      wind: 166,
      countryId: 160,
      regionId: 6,
      subregionId: 2,
      altitude: 180,
      altitudeDiff: -12,
    }

    expect(encodeTakeoffRow(takeoff)).toEqual([
      6246,
      'Jorde på Løten, Klæpa airport',
      60.8,
      11.3,
      166,
      160,
      6,
      2,
      180,
      -12,
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
})
