import { describe, expect, it, vi } from 'vitest'

// Same reasoning as takeoffs.test.ts/clubs.test.ts: mock 'server-only', next/cache, http.ts
// and parse-takeoff-detail.ts so this test exercises only takeoff-detail.ts's own contract —
// the request shape, referer, and cache tag — not the parser or the network.
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-takeoff-detail', () => ({ parseTakeoffDetail: vi.fn() }))

import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText } from './http'
import { parseTakeoffDetail } from './parse-takeoff-detail'
import { getTakeoffDetail } from './takeoff-detail'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParse = vi.mocked(parseTakeoffDetail)
const mockedCacheLife = vi.mocked(cacheLife)
const mockedCacheTag = vi.mocked(cacheTag)

describe('getTakeoffDetail', () => {
  it('requests a=22 for the given country/takeoff with the takeoffs-in-country referer, caches hourly under a per-takeoff tag, and returns the parsed result', async () => {
    mockedFetch.mockResolvedValue('<html>takeoff detail stub</html>')
    mockedParse.mockReturnValue({
      takeoffId: 179,
      name: 'Drammen, Solbergåsen',
      region: 'Buskerud',
      altitude: '401 meters asl',
      description: 'stub',
      linkUrl: null,
      createdAt: null,
      updatedAt: null,
      siteRecords: [],
    })

    const detail = await getTakeoffDetail(160, 179)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=22&country_id=160&start_id=179', {
      referer: 'https://flightlog.org/fl.html?l=1&a=21&country_id=160',
    })
    expect(mockedParse).toHaveBeenCalledWith('<html>takeoff detail stub</html>', 179)
    expect(detail?.name).toBe('Drammen, Solbergåsen')
    expect(mockedCacheLife).toHaveBeenCalledWith('hours')
    expect(mockedCacheTag).toHaveBeenCalledWith('takeoff-160-179')
  })

  it('keys the query string and the cache tag on the requested country/takeoff, not fixed ones', async () => {
    mockedFetch.mockResolvedValue('<html>stub</html>')
    mockedParse.mockReturnValue(null)

    const detail = await getTakeoffDetail(29, 42)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=22&country_id=29&start_id=42', expect.anything())
    expect(mockedCacheTag).toHaveBeenCalledWith('takeoff-29-42')
    expect(detail).toBeNull()
  })
})
