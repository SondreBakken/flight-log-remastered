import { describe, expect, it } from 'vitest'
import { parseCanonicalCountryId } from './country-id'

describe('parseCanonicalCountryId', () => {
  it('accepts a canonical decimal id whether or not it is curated', () => {
    expect(parseCanonicalCountryId('160')).toBe(160)
    expect(parseCanonicalCountryId('203')).toBe(203) // Sweden — not in any curated set; this parser has no curation opinion
  })

  it('accepts the canonical spelling of zero (curation and the id<=0 guard are the caller\'s job, not this parser\'s)', () => {
    expect(parseCanonicalCountryId('0')).toBe(0)
  })

  // Same alias set parseCuratedCountryId rejects — the format check is shared, so an alias
  // must be rejected here independent of curation membership.
  it.each(['0xA0', '0Xa0', '160.0', '1.6e2', '+160', ' 160 ', '160.', '\n160\t'])(
    'rejects the alias %j even though Number() would normalise it to 160',
    (alias) => {
      expect(Number(alias)).toBe(160)
      expect(parseCanonicalCountryId(alias)).toBeNull()
    },
  )

  it.each(['abc', '', '-160', '01', '160abc'])('rejects the malformed id %j', (malformed) => {
    expect(parseCanonicalCountryId(malformed)).toBeNull()
  })

  // Two distinct 20-digit spellings that both match the canonical regex and both `Number()`
  // to the same 1e20 (a double can only represent integers exactly up to 2^53-1) — without
  // the round-trip check, both would resolve to one cache tag under two different URLs.
  it('rejects a digit string too large to round-trip through Number exactly, even when it matches the canonical regex', () => {
    expect(Number('99999999999999999999')).toBe(1e20) // sanity: both collide under plain Number()
    expect(Number('100000000000000000000')).toBe(1e20)
    expect(parseCanonicalCountryId('99999999999999999999')).toBeNull()
    expect(parseCanonicalCountryId('100000000000000000000')).toBeNull()
  })

  it('still accepts a large id that round-trips exactly through Number', () => {
    expect(parseCanonicalCountryId('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER)
  })
})
