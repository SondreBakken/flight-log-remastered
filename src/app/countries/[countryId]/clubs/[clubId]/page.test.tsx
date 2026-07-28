import { describe, expect, it, vi } from 'vitest'

// Same reasoning as the sibling clubs-list and takeoff-detail page tests: mocking the real
// fetchers (which import 'server-only') keeps this test from ever touching the network.
vi.mock('@/lib/flightlog/club', () => ({ getClub: vi.fn() }))
vi.mock('@/lib/flightlog/club-stats', () => ({ getClubStats: vi.fn() }))
vi.mock('@/lib/flightlog/countries', () => ({ getCountries: vi.fn() }))

import { getClub } from '@/lib/flightlog/club'
import { getClubStats } from '@/lib/flightlog/club-stats'
import { getCountries } from '@/lib/flightlog/countries'
import { Club } from './page'

const mockedGetClub = vi.mocked(getClub)
const mockedGetClubStats = vi.mocked(getClubStats)
const mockedGetCountries = vi.mocked(getCountries)

describe('Club route guard', () => {
  it.each(['0', '-5', 'abc', ''])('renders notFound for a malformed countryId %j without calling any fetcher', async (countryId) => {
    await expect(Club({ params: Promise.resolve({ countryId, clubId: '51' }) })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    })
    expect(mockedGetClub).not.toHaveBeenCalled()
    expect(mockedGetClubStats).not.toHaveBeenCalled()
  })

  it.each(['0', '-5', 'abc', ''])('renders notFound for a malformed clubId %j without calling any fetcher', async (clubId) => {
    await expect(Club({ params: Promise.resolve({ countryId: '160', clubId }) })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    })
    expect(mockedGetClub).not.toHaveBeenCalled()
    expect(mockedGetClubStats).not.toHaveBeenCalled()
  })

  // The alias spellings /countries/[countryId] itself rejects (see that page's own test) —
  // this route reuses the same parseCanonicalCountryId guard, so it must reject them too.
  it.each(['0xA0', '160.0', '1.6e2', '+160'])('renders notFound for the countryId alias %j', async (alias) => {
    await expect(Club({ params: Promise.resolve({ countryId: alias, clubId: '51' }) })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    })
    expect(mockedGetClub).not.toHaveBeenCalled()
  })

  it('renders notFound when getClub resolves null (the 0-byte-body not-found signal) rather than rendering an empty club', async () => {
    mockedGetClub.mockResolvedValue(null)
    mockedGetClubStats.mockResolvedValue([])
    mockedGetCountries.mockResolvedValue([{ countryId: 160, name: 'Norway' }])

    await expect(Club({ params: Promise.resolve({ countryId: '160', clubId: '999999999' }) })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    })
  })

  it('fetches club (with roster) and stats, and renders the page with the resolved country name', async () => {
    mockedGetCountries.mockResolvedValue([
      { countryId: 160, name: 'Norway' },
      { countryId: 203, name: 'Sweden' },
    ])
    mockedGetClub.mockResolvedValue({
      detail: {
        clubId: 51,
        name: 'Voss Hang- Og Paragliderklubb',
        memberCount: 1,
        coordinatesText: null,
        mapUrl: null,
        description: null,
        linkUrl: null,
        createdAt: null,
        updatedAt: null,
      },
      roster: [{ userId: 1, name: 'Ade Hawkins' }],
    })
    mockedGetClubStats.mockResolvedValue([{ name: 'Ade Hawkins', flights: 14, distanceKm: 0, hours: 1.1 }])

    const element = await Club({ params: Promise.resolve({ countryId: '160', clubId: '51' }) })

    expect(mockedGetClub).toHaveBeenCalledWith(160, 51)
    // clubId only — never country_id — is #7's own explicit requirement for this fetcher's
    // signature (see club-stats.ts's own doc comment on why country_id is decorative and
    // omitting club_id silently returns a different club's stats).
    expect(mockedGetClubStats).toHaveBeenCalledWith(51)
    expect(element.props.countryName).toBe('Norway')
    expect(element.props.roster).toEqual([{ userId: 1, name: 'Ade Hawkins' }])
    expect(element.props.stats).toEqual([{ name: 'Ade Hawkins', flights: 14, distanceKm: 0, hours: 1.1 }])
  })
})
