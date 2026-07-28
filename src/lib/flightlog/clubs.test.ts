import { describe, expect, it, vi } from 'vitest'

// clubs.ts imports 'server-only' directly, which throws on plain import outside a
// react-server bundling context, and next/cache's cacheLife/cacheTag throw outside a real
// Next request when not stubbed — mock both, plus http.ts (the network boundary) and
// parse-clubs.ts, so this test exercises only clubs.ts's own contract: which action code,
// query params, and referer it sends, and how it wires the cache.
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-clubs', () => ({ parseClubs: vi.fn() }))

import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText } from './http'
import { parseClubs } from './parse-clubs'
import { getClubs } from './clubs'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParseClubs = vi.mocked(parseClubs)
const mockedCacheLife = vi.mocked(cacheLife)
const mockedCacheTag = vi.mocked(cacheTag)

describe('getClubs', () => {
  it('requests a=25 for the given country with the country-index-page referer, caches for days under a per-country tag, and returns the parsed result', async () => {
    mockedFetch.mockResolvedValue('<html>norway stub</html>')
    mockedParseClubs.mockReturnValue([{ clubId: 32, name: 'Jetta Luftsportsklubb', memberCount: 18 }])

    const clubs = await getClubs(160)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=25&country_id=160', {
      referer: 'https://flightlog.org/fl.html?l=1&a=3',
    })
    expect(mockedParseClubs).toHaveBeenCalledWith('<html>norway stub</html>', 160)
    expect(clubs).toEqual([{ clubId: 32, name: 'Jetta Luftsportsklubb', memberCount: 18 }])
    expect(mockedCacheLife).toHaveBeenCalledWith('days')
    expect(mockedCacheTag).toHaveBeenCalledWith('country-160')
  })

  it('keys the query string and the cache tag on the requested country, not a fixed one', async () => {
    mockedFetch.mockResolvedValue('<html>bouvet stub</html>')
    mockedParseClubs.mockReturnValue([])

    await getClubs(29)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=25&country_id=29', expect.anything())
    expect(mockedCacheTag).toHaveBeenCalledWith('country-29')
  })
})
