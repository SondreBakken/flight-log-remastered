import { describe, expect, it, vi } from 'vitest'

// Same reasoning as takeoff-detail.test.ts: mock 'server-only', next/cache, http.ts and
// parse-flight-detail.ts so this test exercises only flight-detail.ts's own contract — the
// request shape, referer, and cache tag — not the parser or the network.
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-flight-detail', () => ({ parseFlightDetail: vi.fn() }))

import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText } from './http'
import { parseFlightDetail } from './parse-flight-detail'
import { getFlightDetail } from './flight-detail'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParse = vi.mocked(parseFlightDetail)
const mockedCacheLife = vi.mocked(cacheLife)
const mockedCacheTag = vi.mocked(cacheTag)

describe('getFlightDetail', () => {
  it('requests a=34 for the given trip with the plain origin as referer, caches for days under the shared per-trip tag, and returns the parsed result', async () => {
    mockedFetch.mockResolvedValue('<html>flight detail stub</html>')
    mockedParse.mockReturnValue({
      tripId: 1001964,
      date: '2026-07-21',
      country: 'Norway',
      takeoff: 'Voss, Hjelle/Gjelle',
      takeoffRef: { countryId: 160, takeoffId: 133 },
      glider: 'Skywalk Mescal 6',
      duration: '00:06',
      distanceKm: null,
      maxAltitude: null,
      description: 'Min første høydetur',
      takeoffType: 'mountain',
    })

    const detail = await getFlightDetail(1001964)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=34&trip_id=1001964', { referer: 'https://flightlog.org' })
    expect(mockedParse).toHaveBeenCalledWith('<html>flight detail stub</html>', 1001964)
    expect(detail?.takeoff).toBe('Voss, Hjelle/Gjelle')
    expect(mockedCacheLife).toHaveBeenCalledWith('days')
    // Same tag getTrack/hasTrack use for this trip — this is deliberately the shared identity,
    // not a coincidence, see this file's own doc comment.
    expect(mockedCacheTag).toHaveBeenCalledWith('trip-1001964')
  })

  it('keys the query string and the cache tag on the requested trip, not a fixed one', async () => {
    mockedFetch.mockResolvedValue('<html>stub</html>')
    mockedParse.mockReturnValue(null)

    const detail = await getFlightDetail(999999999)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=34&trip_id=999999999', expect.anything())
    expect(mockedCacheTag).toHaveBeenCalledWith('trip-999999999')
    expect(detail).toBeNull()
  })
})
