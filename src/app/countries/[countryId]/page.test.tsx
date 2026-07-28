import { describe, expect, it, vi } from 'vitest'

// The real fetchers import 'server-only', which throws on plain import outside a
// react-server bundling context — mocking the whole module (hoisted above these imports
// by Vitest) means that code never runs, so this test never touches the network.
vi.mock('@/lib/flightlog/clubs', () => ({ getClubs: vi.fn() }))
vi.mock('@/lib/flightlog/countries', () => ({ getCountries: vi.fn() }))

// Mocked to a two-id set local to this file (not the real production list, currently just
// [160]) and — deliberately — exporting ONLY CURATED_CLUB_COUNTRY_IDS, not
// CURATED_TAKEOFF_COUNTRY_IDS. curated-countries.ts's own doc comment says the two curations
// answer different questions and only coincide today (both [160]) because they happened to be
// measured in the same pass; nothing enforced that distinction here before. Two DIFFERENT ids
// makes a structural match on the wrong array visibly wrong rather than accidentally correct,
// and since the real CURATED_TAKEOFF_COUNTRY_IDS isn't part of this mock at all, generateStaticParams
// reading it instead of CURATED_CLUB_COUNTRY_IDS resolves to undefined and throws at test time
// (the same technique route.test.ts already uses for the takeoffs route's own
// generateStaticParams test).
vi.mock('@/lib/flightlog/curated-countries', () => ({
  CURATED_CLUB_COUNTRY_IDS: [160, 203],
}))

import { getClubs } from '@/lib/flightlog/clubs'
import { getCountries } from '@/lib/flightlog/countries'
import { CURATED_CLUB_COUNTRY_IDS } from '@/lib/flightlog/curated-countries'
import { Clubs, generateStaticParams } from './page'

const mockedGetClubs = vi.mocked(getClubs)
const mockedGetCountries = vi.mocked(getCountries)

describe('generateStaticParams', () => {
  it('returns exactly the curated CLUB country ids, as canonical decimal strings — not CURATED_TAKEOFF_COUNTRY_IDS, which this mock deliberately leaves undefined', async () => {
    expect(await generateStaticParams()).toEqual(CURATED_CLUB_COUNTRY_IDS.map((countryId) => ({ countryId: String(countryId) })))
  })
})

describe('Clubs route guard', () => {
  it.each(['0', '-5', 'abc', ''])(
    'renders notFound for a malformed countryId %j without calling either fetcher',
    async (countryId) => {
      await expect(Clubs({ params: Promise.resolve({ countryId }) })).rejects.toMatchObject({
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      })
      expect(mockedGetClubs).not.toHaveBeenCalled()
      expect(mockedGetCountries).not.toHaveBeenCalled()
    },
  )

  // Every alias here normalises to 160 under plain `Number()` (and `Number.isInteger` is
  // true for all of them too), so a guard built on `Number()` + `Number.isInteger` alone
  // would render the page for each of them — a distinct URL per alias, none of them
  // prerendered, for content identical to the curated `/countries/160`.
  it.each(['0xA0', '0Xa0', '160.0', '1.6e2', '+160', ' 160 ', '160.', '\n160\t'])(
    'renders notFound for the alias %j even though it normalises to 160, without calling either fetcher',
    async (alias) => {
      await expect(Clubs({ params: Promise.resolve({ countryId: alias }) })).rejects.toMatchObject({
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      })
      expect(mockedGetClubs).not.toHaveBeenCalled()
      expect(mockedGetCountries).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['160', 160, 'Norway'],
    ['203', 203, 'Sweden'],
  ])(
    'fetches clubs and countries and renders the page for id %s',
    async (countryId, expectedId, expectedName) => {
      // Two countries, listed with the match NOT at index 0, so `countries[0]` and
      // `find(country => country.countryId === id)` disagree for the 203 case — and two
      // different requested ids so `getClubs(160)` cannot be hardcoded to satisfy both runs.
      mockedGetCountries.mockResolvedValue([
        { countryId: 160, name: 'Norway' },
        { countryId: 203, name: 'Sweden' },
      ])
      mockedGetClubs.mockResolvedValue([{ clubId: 32, name: 'Jetta Luftsportsklubb', memberCount: 18 }])

      const element = await Clubs({ params: Promise.resolve({ countryId }) })

      expect(mockedGetClubs).toHaveBeenCalledWith(expectedId)
      expect(element.props.countryName).toBe(expectedName)
      expect(element.props.clubs).toEqual([{ clubId: 32, name: 'Jetta Luftsportsklubb', memberCount: 18 }])
    },
  )
})
