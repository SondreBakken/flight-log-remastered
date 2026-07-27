import { describe, expect, it, vi } from 'vitest'

// getTakeoffs pulls in 'server-only', next/cache and http.ts transitively — mock the whole
// module (hoisted above these imports by Vitest) so this test never touches the network and
// exercises only route.ts's own wiring: which id it asks for, and how it shapes the answer.
vi.mock('@/lib/flightlog/takeoffs', () => ({ getTakeoffs: vi.fn() }))

// Mocked to a two-id set local to this file, rather than asserting against the real
// production list (currently just Norway) — the "not hardcoded" test below needs two
// DIFFERENT valid ids to prove the id flows through per-request, and that must hold
// regardless of how many countries production has actually curated.
vi.mock('@/lib/flightlog/curated-countries', () => ({ CURATED_TAKEOFF_COUNTRY_IDS: [160, 203] }))

import { getTakeoffs } from '@/lib/flightlog/takeoffs'
import type { Takeoff } from '@/lib/flightlog/types'
import { GET, generateStaticParams } from './route'

const mockedGetTakeoffs = vi.mocked(getTakeoffs)

describe('generateStaticParams', () => {
  it('enumerates exactly the curated country ids, as strings', async () => {
    const params = await generateStaticParams()

    expect(params).toEqual([{ countryId: '160' }, { countryId: '203' }])
  })
})

describe('GET', () => {
  it.each([
    ['160', 160],
    ['203', 203],
  ])('asks getTakeoffs for the country id parsed from THIS request\'s params (%s), not a fixed one', async (countryId, expectedId) => {
    mockedGetTakeoffs.mockResolvedValue([])

    await GET(new Request('http://localhost/api/countries/x/takeoffs'), { params: Promise.resolve({ countryId }) })

    expect(mockedGetTakeoffs).toHaveBeenCalledWith(expectedId)
    expect(mockedGetTakeoffs).toHaveBeenCalledTimes(1)
  })

  it('responds with the takeoffs encoded as wire rows, in the fixed field order', async () => {
    const takeoff: Takeoff = {
      takeoffId: 6246,
      name: 'Jorde på Løten',
      lat: 60.8,
      lon: 11.3,
      wind: 166,
      countryId: 160,
      regionId: 6,
      subregionId: 2,
      altitude: 180,
      altitudeDiff: -12,
    }
    mockedGetTakeoffs.mockResolvedValue([takeoff])

    const response = await GET(new Request('http://localhost/api/countries/160/takeoffs'), {
      params: Promise.resolve({ countryId: '160' }),
    })
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([[6246, 'Jorde på Løten', 60.8, 11.3, 166, 160, 6, 2, 180, -12]])
  })

  it('responds with an empty array for a curated country with genuinely zero takeoffs, not an error', async () => {
    mockedGetTakeoffs.mockResolvedValue([])

    const response = await GET(new Request('http://localhost/api/countries/160/takeoffs'), {
      params: Promise.resolve({ countryId: '160' }),
    })
    const body: unknown = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual([])
  })

  it('responds 404 for an uncurated country id, without ever calling getTakeoffs', async () => {
    const response = await GET(new Request('http://localhost/api/countries/29/takeoffs'), {
      params: Promise.resolve({ countryId: '29' }),
    })

    expect(response.status).toBe(404)
    expect(mockedGetTakeoffs).not.toHaveBeenCalled()
  })
})
