import { describe, expect, it, vi } from 'vitest'

// Same reasoning as clubs.test.ts/countries.test.ts: mock 'server-only', next/cache, http.ts
// and parse-takeoffs.ts so this test exercises only takeoffs.ts's own contract.
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-takeoffs', () => ({ parseTakeoffs: vi.fn() }))

import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText } from './http'
import { parseTakeoffs } from './parse-takeoffs'
import { getTakeoffs } from './takeoffs'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParseTakeoffs = vi.mocked(parseTakeoffs)
const mockedCacheLife = vi.mocked(cacheLife)
const mockedCacheTag = vi.mocked(cacheTag)

describe('getTakeoffs', () => {
  it('requests rqtid=11 for the given country with the site-root referer, caches for days under the shared per-country tag, and returns the parsed result', async () => {
    mockedFetch.mockResolvedValue('<html>norway takeoffs stub</html>')
    mockedParseTakeoffs.mockReturnValue([
      { takeoffId: 6246, name: 'Jorde på Løten', lat: 60.8, lon: 11.3, wind: 56, countryId: 160, regionId: 6, subregionId: 0, altitude: 180, altitudeDiff: 0 },
    ])

    const takeoffs = await getTakeoffs(160)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?rqtid=11&country_id=160', { referer: 'https://flightlog.org' })
    expect(mockedParseTakeoffs).toHaveBeenCalledWith('<html>norway takeoffs stub</html>', 160)
    expect(takeoffs).toEqual([
      { takeoffId: 6246, name: 'Jorde på Løten', lat: 60.8, lon: 11.3, wind: 56, countryId: 160, regionId: 6, subregionId: 0, altitude: 180, altitudeDiff: 0 },
    ])
    expect(mockedCacheLife).toHaveBeenCalledWith('days')
    expect(mockedCacheTag).toHaveBeenCalledWith('country-160')
  })

  it('keys the query string and the cache tag on the requested country, not a fixed one', async () => {
    mockedFetch.mockResolvedValue('<html>bouvet takeoffs stub</html>')
    mockedParseTakeoffs.mockReturnValue([])

    await getTakeoffs(29)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?rqtid=11&country_id=29', expect.anything())
    expect(mockedCacheTag).toHaveBeenCalledWith('country-29')
  })
})
