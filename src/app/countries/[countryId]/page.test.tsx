import { describe, expect, it, vi } from 'vitest'

// The real fetchers import 'server-only', which throws on plain import outside a
// react-server bundling context — mocking the whole module (hoisted above these imports
// by Vitest) means that code never runs, so this test never touches the network.
vi.mock('@/lib/flightlog/clubs', () => ({ getClubs: vi.fn() }))
vi.mock('@/lib/flightlog/countries', () => ({ getCountries: vi.fn() }))

import { getClubs } from '@/lib/flightlog/clubs'
import { getCountries } from '@/lib/flightlog/countries'
import { Clubs } from './page'

const mockedGetClubs = vi.mocked(getClubs)
const mockedGetCountries = vi.mocked(getCountries)

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

  it('fetches clubs and countries and renders the page for a valid id', async () => {
    mockedGetCountries.mockResolvedValue([{ countryId: 160, name: 'Norway' }])
    mockedGetClubs.mockResolvedValue([{ clubId: 32, name: 'Jetta Luftsportsklubb', flightCount: 18 }])

    const element = await Clubs({ params: Promise.resolve({ countryId: '160' }) })

    expect(mockedGetClubs).toHaveBeenCalledWith(160)
    expect(element.props.countryName).toBe('Norway')
    expect(element.props.clubs).toEqual([{ clubId: 32, name: 'Jetta Luftsportsklubb', flightCount: 18 }])
  })
})
