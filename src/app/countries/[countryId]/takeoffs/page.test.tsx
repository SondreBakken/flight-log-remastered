import { describe, expect, it, vi } from 'vitest'

// The real fetchers import 'server-only', which throws on plain import outside a
// react-server bundling context — mocking the whole module (hoisted above these imports by
// Vitest) means that code never runs, so this test never touches the network. Same pattern
// the sibling Clubs route (../page.test.tsx) already uses for the same reason.
vi.mock('@/lib/flightlog/countries', () => ({ getCountries: vi.fn() }))
vi.mock('@/lib/flightlog/regions', () => ({ getRegions: vi.fn() }))

import { getCountries } from '@/lib/flightlog/countries'
import { getRegions } from '@/lib/flightlog/regions'
import TakeoffDirectory from '@/features/browse-country-takeoffs'
import TakeoffsPage from './page'

const mockedGetCountries = vi.mocked(getCountries)
const mockedGetRegions = vi.mocked(getRegions)

describe('TakeoffsPage route guard', () => {
  it.each(['0', '-5', 'abc', '', '999'])(
    'renders notFound for a malformed or uncurated countryId %j, without calling either fetcher',
    async (countryId) => {
      await expect(TakeoffsPage({ params: Promise.resolve({ countryId }) })).rejects.toMatchObject({
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      })
      expect(mockedGetCountries).not.toHaveBeenCalled()
      expect(mockedGetRegions).not.toHaveBeenCalled()
    },
  )

  // Every alias here normalises to 160 under plain `Number()` (and `Number.isInteger` is
  // true for all of them too), so a guard built on `Number()` + `Number.isInteger` alone
  // would render the directory for each — a distinct URL per alias, none of them prerendered.
  it.each(['0xA0', '0Xa0', '160.0', '1.6e2', '+160', ' 160 ', '160.', '\n160\t'])(
    'renders notFound for the alias %j even though it normalises to 160',
    async (alias) => {
      await expect(TakeoffsPage({ params: Promise.resolve({ countryId: alias }) })).rejects.toMatchObject({
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      })
    },
  )

  // No `searchParams` param at all any more — see page.tsx's own comment on why: the wind
  // filter's initial value is now read client-side, inside TakeoffDirectory, specifically so
  // this page never needs a Suspense boundary or a dynamic hole for it.
  it('fetches countries and regions and forwards the parsed id, the resolved country name, and region names (not bare ids) directly to the directory', async () => {
    mockedGetCountries.mockResolvedValue([
      { countryId: 160, name: 'Norway' },
      { countryId: 203, name: 'Sweden' },
    ])
    mockedGetRegions.mockResolvedValue([
      { regionId: 6, name: 'Nordland', countryId: 160 },
      { regionId: 61, name: 'Møre og Romsdal', countryId: 160 },
    ])

    const element = await TakeoffsPage({ params: Promise.resolve({ countryId: '160' }) })

    expect(mockedGetRegions).toHaveBeenCalledWith(160)
    expect(element.type).toBe(TakeoffDirectory)
    expect(element.props.countryId).toBe(160)
    expect(element.props.countryName).toBe('Norway')
    expect(element.props.regions).toEqual([
      { regionId: 6, name: 'Nordland' },
      { regionId: 61, name: 'Møre og Romsdal' },
    ])
  })

  it('falls back to a generic label when the resolved country id is absent from getCountries, rather than crashing', async () => {
    mockedGetCountries.mockResolvedValue([{ countryId: 203, name: 'Sweden' }])
    mockedGetRegions.mockResolvedValue([])

    const element = await TakeoffsPage({ params: Promise.resolve({ countryId: '160' }) })

    expect(element.props.countryName).toBe('Country 160')
  })
})
