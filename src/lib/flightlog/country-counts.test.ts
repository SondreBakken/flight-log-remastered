import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-country-counts', () => ({ parseCountryCounts: vi.fn() }))

import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText } from './http'
import { parseCountryCounts } from './parse-country-counts'
import { getCountryCounts } from './country-counts'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParse = vi.mocked(parseCountryCounts)

describe('getCountryCounts', () => {
  it('requests a=3 with the site-root referer, caches for days under a tag, and returns entry arrays', async () => {
    mockedFetch.mockResolvedValue('<html>a3 stub</html>')
    mockedParse.mockReturnValue({
      pilots: new Map([[160, 1293]]),
      clubs: new Map([[160, 12]]),
    })

    const counts = await getCountryCounts()

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=3', { referer: 'https://flightlog.org' })
    expect(mockedParse).toHaveBeenCalledWith('<html>a3 stub</html>')
    expect(counts).toEqual({ pilots: [[160, 1293]], clubs: [[160, 12]] })
    expect(vi.mocked(cacheLife)).toHaveBeenCalledWith('days')
    expect(vi.mocked(cacheTag)).toHaveBeenCalledWith('country-counts')
  })

  it('throws when no club counts parse, so the empty result is never cached', async () => {
    mockedFetch.mockResolvedValue('<html>unreadable</html>')
    mockedParse.mockReturnValue({ pilots: new Map([[160, 1]]), clubs: new Map() })

    await expect(getCountryCounts()).rejects.toThrow(/no club counts/)
  })
})
