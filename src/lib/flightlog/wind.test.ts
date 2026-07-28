import { describe, expect, it } from 'vitest'
import { decodeWindDirections, windIncludesDirection, type CompassOctant } from './wind'

// Every one of the 8 pinned single-bit values, asserted individually against a real live
// sample (see wind.ts's doc comment and docs/flightlog-api.md for the takeoff each came
// from). This is deliberate, not just thorough: a mapping bug that rotates every octant by
// one position, or reverses the direction of travel around the compass, still gets *some*
// bits right by coincidence (an all-8-tested table has no coincidental full pass), but it
// cannot pass all eight of these — each row pins one bit to one direction and nothing else.
describe('decodeWindDirections — the 8 pinned single-bit values', () => {
  it.each([
    [128, 'N'],
    [64, 'NE'],
    [32, 'E'],
    [16, 'SE'],
    [8, 'S'],
    [4, 'SW'],
    [2, 'W'],
    [1, 'NW'],
  ] as const)('wind=%d decodes to [%s]', (wind, octant) => {
    expect(decodeWindDirections(wind)).toEqual([octant])
  })
})

describe('decodeWindDirections — the ends and a real contiguous run', () => {
  it('wind=0 decodes to no directions — none recorded', () => {
    expect(decodeWindDirections(0)).toEqual([])
  })

  it('wind=255 decodes to all eight, in clockwise order — confirmed against a live wind=255 takeoff', () => {
    expect(decodeWindDirections(255)).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])
  })

  it('wind=28 (0b00011100) decodes to the real live sample: SE, S, SW, in clockwise order', () => {
    // Live takeoff (Dovre, id 2924): a=22's alt text read " SE S SW" for this exact value.
    // This pins bits 2 and 4's UNION with bit 3 (S), not bits 2 and 4 individually — the set
    // {SE, S, SW} is identical under this mapping and under one with bits 2 and 4 transposed,
    // so this sample alone can't and doesn't distinguish them. Bits 2 and 4 are independently
    // pinned by their own single-bit live samples below (wind=4, wind=16); this case exists to
    // corroborate the multi-bit path, not to establish the mapping.
    expect(decodeWindDirections(28)).toEqual(['SE', 'S', 'SW'])
  })

  it('a non-adjacent pair (N + S) decodes in clockwise order, not bit order — catches an order regression separately from a mapping regression', () => {
    // wind = 128 (N) | 8 (S) = 136. Bit order would put S (bit 3) before N (bit 7); the
    // canonical clockwise order this module promises puts N first.
    expect(decodeWindDirections(136)).toEqual(['N', 'S'])
  })
})

describe('windIncludesDirection', () => {
  it.each([
    [128, 'N'],
    [64, 'NE'],
    [32, 'E'],
    [16, 'SE'],
    [8, 'S'],
    [4, 'SW'],
    [2, 'W'],
    [1, 'NW'],
  ] as const)('wind=%d includes %s', (wind, octant) => {
    expect(windIncludesDirection(wind, octant)).toBe(true)
  })

  it('a single-bit value excludes every other direction — the #12 filter needs the negative case as much as the positive one', () => {
    const others: Array<Parameters<typeof windIncludesDirection>[1]> = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W']
    for (const octant of others) {
      expect(windIncludesDirection(1, octant)).toBe(false) // wind=1 is NW alone
    }
  })

  it('wind=0 excludes every direction', () => {
    const all: Array<Parameters<typeof windIncludesDirection>[1]> = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    for (const octant of all) {
      expect(windIncludesDirection(0, octant)).toBe(false)
    }
  })

  it('wind=255 includes every direction', () => {
    const all: Array<Parameters<typeof windIncludesDirection>[1]> = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    for (const octant of all) {
      expect(windIncludesDirection(255, octant)).toBe(true)
    }
  })
})

describe('input validation — a corrupt or mis-decoded wind is a bug worth throwing on, not silently masking', () => {
  it.each([256, -1, 300, -100])('rejects out-of-byte-range wind=%d', (wind) => {
    expect(() => decodeWindDirections(wind)).toThrow(RangeError)
  })

  it.each([1.5, NaN, Infinity])('rejects non-integer wind=%d', (wind) => {
    expect(() => decodeWindDirections(wind)).toThrow(RangeError)
  })

  // decodeWindDirections and windIncludesDirection each carry their own assertWindByte call.
  // Without a test exercising windIncludesDirection's validation directly, either call is
  // individually deletable with the suite still green — decodeWindDirections's call would mask
  // windIncludesDirection's, since decodeWindDirections always validates before it ever reaches
  // windIncludesDirection.
  it.each([256, -1, 1.5, NaN])('windIncludesDirection also rejects a corrupt wind=%d', (wind) => {
    expect(() => windIncludesDirection(wind, 'N')).toThrow(RangeError)
  })

  it('windIncludesDirection rejects an invalid octant instead of silently aliasing NW', () => {
    // BIT_FOR_OCTANT[octant] on an unknown key is undefined, and `1 << undefined` is `1` (NW's
    // bit) — without validation this would return true for any garbage octant. #12's filter
    // takes a direction from a URL query parameter, which the CompassOctant type does not stop
    // from being invalid at runtime.
    expect(() => windIncludesDirection(1, 'invalid' as CompassOctant)).toThrow(RangeError)
  })
})
