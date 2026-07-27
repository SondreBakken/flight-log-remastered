import { describe, expect, it } from 'vitest'
import { CURATED_TAKEOFF_COUNTRY_IDS, parseCuratedCountryId } from './curated-countries'

describe('parseCuratedCountryId', () => {
  it('accepts the exact canonical decimal spelling generateStaticParams produces', () => {
    expect(parseCuratedCountryId('160')).toBe(160)
    expect(CURATED_TAKEOFF_COUNTRY_IDS).toContain(160)
  })

  it('rejects a canonical decimal id that is not in the curated set', () => {
    expect(parseCuratedCountryId('29')).toBeNull()
  })

  // Every one of these normalises to 160 under plain `Number()`, so a check that runs
  // `Number(raw)` before validating the spelling would wrongly accept all eight — each is a
  // distinct URL, and therefore a distinct anonymous trigger for the request-time
  // `getTakeoffs` fetch prerendering exists to eliminate.
  it.each(['0xA0', '0Xa0', '160.0', '1.6e2', '+160', ' 160 ', '160.', '\n160\t'])(
    'rejects the alias %j even though Number() would normalise it to 160',
    (alias) => {
      expect(Number(alias)).toBe(160) // sanity: this really is an alias under plain Number()
      expect(parseCuratedCountryId(alias)).toBeNull()
    },
  )

  it.each(['abc', '', '-160', '01', '160abc'])('rejects the malformed id %j', (malformed) => {
    expect(parseCuratedCountryId(malformed)).toBeNull()
  })
})
