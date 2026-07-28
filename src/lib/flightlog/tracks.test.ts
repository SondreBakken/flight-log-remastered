import { describe, expect, it, vi } from 'vitest'

// Same reasoning as takeoffs.test.ts/clubs.test.ts: mock 'server-only', next/cache, and
// http.ts so this test exercises only tracks.ts's own contract — specifically here, the
// outbound-request COUNT, which is the whole point of this file (see below).
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))

import { fetchFlightlogText } from './http'
import { getTrackedTripEntries, getTrackedTripIds, getTracksForPilot } from './tracks'

const mockedFetch = vi.mocked(fetchFlightlogText)

function trackIndexResponse(items: Array<[number, string]>): string {
  return JSON.stringify({ data_item_count: items.length, data_items: items })
}

describe('getTrackedTripEntries / getTrackedTripIds — proof of ZERO new outbound requests (issue #5)', () => {
  // The measured claim issue #5 is built on: getTracksForPilot's rqtid=21 response already
  // carries `ts` for every entry (see types.ts's TrackIndexEntry), and getTrackedTripIds used
  // to throw it away. Plumbing it through must not add a single extra fetchFlightlogText call
  // — this test proves that by COUNTING calls, not by reading the diff and trusting it.

  it('getTrackedTripEntries makes exactly one fetchFlightlogText call per requested year, not one per year plus one for the timestamps', async () => {
    mockedFetch
      .mockResolvedValueOnce(trackIndexResponse([[1, '20260101000000']]))
      .mockResolvedValueOnce(trackIndexResponse([[2, '20250101000000']]))

    const entries = await getTrackedTripEntries(4549, [2026, 2025])

    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(entries).toEqual([
      { tripId: 1, updatedAt: '20260101000000' },
      { tripId: 2, updatedAt: '20250101000000' },
    ])
  })

  it('getTrackedTripIds (still used by the pilot logbook page) makes the SAME number of calls as before — deriving it from getTrackedTripEntries costs nothing extra', async () => {
    mockedFetch
      .mockResolvedValueOnce(trackIndexResponse([[1, '20260101000000']]))
      .mockResolvedValueOnce(trackIndexResponse([[2, '20250101000000']]))

    const ids = await getTrackedTripIds(4549, [2026, 2025])

    expect(mockedFetch).toHaveBeenCalledTimes(2)
    expect(ids).toEqual(new Set([1, 2]))
  })

  it('an empty rqtid=21 response for a year (a pilot with no uploaded tracks that year) still costs exactly one call and returns no entries, not an error and not a retry', async () => {
    mockedFetch.mockResolvedValueOnce(trackIndexResponse([]))

    const entries = await getTrackedTripEntries(12677, [2026])

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(entries).toEqual([])
  })

  it('getTracksForPilot itself is untouched: still one fetch per (pilot, year), still parsing updatedAt from the same field', async () => {
    mockedFetch.mockResolvedValueOnce(trackIndexResponse([[991729, '20260523164423']]))

    const entries = await getTracksForPilot(4549, 2026)

    expect(mockedFetch).toHaveBeenCalledTimes(1)
    expect(entries).toEqual([{ tripId: 991729, updatedAt: '20260523164423' }])
  })
})
