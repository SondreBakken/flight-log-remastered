import { describe, expect, it, vi } from 'vitest'

// Same reasoning as clubs.test.ts/countries.test.ts: mock 'server-only', next/cache, http.ts
// and parse-regions.ts so this test exercises only regions.ts's own contract.
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-regions', () => ({ parseRegions: vi.fn() }))

import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText } from './http'
import { parseRegions } from './parse-regions'
import { getRegions } from './regions'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParseRegions = vi.mocked(parseRegions)
const mockedCacheLife = vi.mocked(cacheLife)
const mockedCacheTag = vi.mocked(cacheTag)

describe('getRegions', () => {
  it('requests rqtid=10 for the given country with the site-root referer, caches for days under the shared per-country tag, and returns the parsed result', async () => {
    mockedFetch.mockResolvedValue('<html>norway regions stub</html>')
    mockedParseRegions.mockReturnValue([{ regionId: 2, name: 'Akershus', countryId: 160 }])

    const regions = await getRegions(160)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?rqtid=10&country_id=160', { referer: 'https://flightlog.org' })
    expect(mockedParseRegions).toHaveBeenCalledWith('<html>norway regions stub</html>', 160)
    expect(regions).toEqual([{ regionId: 2, name: 'Akershus', countryId: 160 }])
    expect(mockedCacheLife).toHaveBeenCalledWith('days')
    expect(mockedCacheTag).toHaveBeenCalledWith('country-160')
  })

  it('keys the query string and the cache tag on the requested country, not a fixed one', async () => {
    mockedFetch.mockResolvedValue('<html>bouvet regions stub</html>')
    mockedParseRegions.mockReturnValue([])

    await getRegions(29)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?rqtid=10&country_id=29', expect.anything())
    expect(mockedCacheTag).toHaveBeenCalledWith('country-29')
  })
})
