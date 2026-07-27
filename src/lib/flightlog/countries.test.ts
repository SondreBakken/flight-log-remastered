import { describe, expect, it, vi } from 'vitest'

// Same reasoning as clubs.test.ts: mock 'server-only', next/cache, http.ts and
// parse-countries.ts so this test exercises only countries.ts's own contract.
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-countries', () => ({ parseCountries: vi.fn() }))

import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText } from './http'
import { parseCountries } from './parse-countries'
import { getCountries } from './countries'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParseCountries = vi.mocked(parseCountries)
const mockedCacheLife = vi.mocked(cacheLife)
const mockedCacheTag = vi.mocked(cacheTag)

describe('getCountries', () => {
  it('requests rqtid=9 with the site-root referer, caches for days under the countries tag, and returns the parsed result', async () => {
    mockedFetch.mockResolvedValue('<html>countries stub</html>')
    mockedParseCountries.mockReturnValue([
      { countryId: 160, name: 'Norway' },
      { countryId: 203, name: 'Sweden' },
    ])

    const countries = await getCountries()

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?rqtid=9', { referer: 'https://flightlog.org' })
    expect(mockedParseCountries).toHaveBeenCalledWith('<html>countries stub</html>')
    expect(countries).toEqual([
      { countryId: 160, name: 'Norway' },
      { countryId: 203, name: 'Sweden' },
    ])
    expect(mockedCacheLife).toHaveBeenCalledWith('days')
    expect(mockedCacheTag).toHaveBeenCalledWith('countries')
  })
})
