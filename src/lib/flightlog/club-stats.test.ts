import { describe, expect, it, vi } from 'vitest'

// Same isolation reasoning as clubs.test.ts: mock server-only, next/cache, the network
// boundary (http.ts) and the parser, so this test exercises only club-stats.ts's own
// contract — the exact query string it builds, the referer, and how it wires the cache.
//
// This file is the fix for #7's own review gap: `getClubStats` is the first fetcher module
// in this directory that shipped without a colocated test, so nothing pinned the one thing
// that actually matters — that `club_id` is present in the URL. Measured live (see
// club-stats.ts's own doc comment): dropping `club_id` from the query string doesn't error,
// it silently returns 146 rows of a completely different club. `toHaveBeenCalledWith`'s exact
// string match is what catches that, not a substring/contains check.
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-club-stats', () => ({ parseClubStats: vi.fn() }))

import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText } from './http'
import { parseClubStats } from './parse-club-stats'
import { getClubStats } from './club-stats'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParseClubStats = vi.mocked(parseClubStats)
const mockedCacheLife = vi.mocked(cacheLife)
const mockedCacheTag = vi.mocked(cacheTag)

describe('getClubStats', () => {
  it('requests rqtid=1 with club_id and the flightlog-origin referer, caches for hours under a per-club tag, and returns the parsed result', async () => {
    mockedFetch.mockResolvedValue('<html>voss stats stub</html>')
    mockedParseClubStats.mockReturnValue([{ name: 'Ade Hawkins', flights: 14, distanceKm: 0, hours: 1.1 }])

    const stats = await getClubStats(51)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?rqtid=1&club_id=51', {
      referer: 'https://flightlog.org',
    })
    expect(mockedParseClubStats).toHaveBeenCalledWith('<html>voss stats stub</html>', 51)
    expect(stats).toEqual([{ name: 'Ade Hawkins', flights: 14, distanceKm: 0, hours: 1.1 }])
    expect(mockedCacheLife).toHaveBeenCalledWith('hours')
    expect(mockedCacheTag).toHaveBeenCalledWith('club-stats-51')
  })

  it('keys the query string and the cache tag on the requested club, not a fixed one', async () => {
    mockedFetch.mockResolvedValue('<html>eiken stats stub</html>')
    mockedParseClubStats.mockReturnValue([])

    await getClubStats(37)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?rqtid=1&club_id=37', expect.anything())
    expect(mockedCacheTag).toHaveBeenCalledWith('club-stats-37')
  })
})
