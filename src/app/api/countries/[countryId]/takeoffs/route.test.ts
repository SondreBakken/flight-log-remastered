import { describe, expect, it, vi } from 'vitest'

// getTakeoffs pulls in 'server-only', next/cache and http.ts transitively — mock the whole
// module (hoisted above these imports by Vitest) so this test never touches the network and
// exercises only route.ts's own wiring: which id it asks for, and how it shapes the answer.
vi.mock('@/lib/flightlog/takeoffs', () => ({ getTakeoffs: vi.fn() }))

// Mocked to a two-id set local to this file, rather than asserting against the real
// production list (currently just Norway) — the "not hardcoded" test below needs two
// DIFFERENT valid ids to prove the id flows through per-request, and that must hold
// regardless of how many countries production has actually curated.
//
// parseCuratedCountryId is reimplemented here against the mocked id list, not imported from
// the real module (a real import would silently keep reading the REAL CURATED_TAKEOFF_COUNTRY_IDS
// via its own closed-over reference, defeating the two-id mock above) — same canonicalisation
// logic the real one uses, so the alias-rejection tests below still exercise the real rule.
vi.mock('@/lib/flightlog/curated-countries', () => {
  const CURATED_TAKEOFF_COUNTRY_IDS = [160, 203]
  const CANONICAL_DECIMAL_ID = /^(0|[1-9]\d*)$/
  return {
    CURATED_TAKEOFF_COUNTRY_IDS,
    parseCuratedCountryId: (raw: string) => {
      if (!CANONICAL_DECIMAL_ID.test(raw)) return null
      const id = Number(raw)
      return CURATED_TAKEOFF_COUNTRY_IDS.includes(id) ? id : null
    },
  }
})

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

  // :countryId is unauthenticated user input straight off the URL — same reasoning as
  // recent-flights/route.ts's MAX_ECHOED_USER_ID_LENGTH: without a cap, a long garbage
  // segment is reflected back at whatever length the caller sent it.
  it('caps the echoed countryId in the 404 body, even for a very long garbage segment', async () => {
    const garbage = '9'.repeat(4000)

    const response = await GET(new Request('http://localhost/api/countries/x/takeoffs'), {
      params: Promise.resolve({ countryId: garbage }),
    })
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(404)
    expect(body.error.length).toBeLessThan(100)
  })

  // Every alias here normalises to 160 under plain `Number()` — each is a distinct URL and
  // therefore a distinct CDN cache key, so accepting any of them turns this route back into
  // an anonymous trigger for the live upstream fetch prerendering exists to eliminate. Only
  // the exact spelling generateStaticParams enumerates ('160') may reach getTakeoffs.
  it.each(['0xA0', '0Xa0', '160.0', '1.6e2', '+160', ' 160 ', '160.', '\n160\t'])(
    'responds 404 for the alias %j, without ever calling getTakeoffs',
    async (alias) => {
      const response = await GET(new Request('http://localhost/api/countries/x/takeoffs'), {
        params: Promise.resolve({ countryId: alias }),
      })

      expect(response.status).toBe(404)
      expect(mockedGetTakeoffs).not.toHaveBeenCalled()
    },
  )

  // getTakeoffs' failure mode (http.ts) embeds the scraped-from upstream path in
  // error.message — same reasoning as recent-flights/route.ts, the first route handler in
  // the repo and the pattern this one follows: that string must never reach the client.
  it('responds 502 with a generic body, never the raw error message, when getTakeoffs throws', async () => {
    mockedGetTakeoffs.mockRejectedValue(new Error('flightlog.org returned 500 for /fl.html?rqtid=11&country_id=160'))

    const response = await GET(new Request('http://localhost/api/countries/160/takeoffs'), {
      params: Promise.resolve({ countryId: '160' }),
    })
    const body: unknown = await response.json()

    expect(response.status).toBe(502)
    expect(JSON.stringify(body)).not.toContain('flightlog.org')
  })
})
