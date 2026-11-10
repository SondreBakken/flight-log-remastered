import { describe, expect, it, vi } from 'vitest'

// Same reasoning as the sibling clubs-list and takeoff-detail page tests: mocking the real
// fetchers (which import 'server-only') keeps this test from ever touching the network.
vi.mock('@/lib/flightlog/club', () => ({ getClub: vi.fn() }))
vi.mock('@/lib/flightlog/club-stats', () => ({ getClubStats: vi.fn() }))
vi.mock('@/lib/flightlog/countries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/flightlog/countries')>()),
  getCountries: vi.fn(),
}))
// The real resolver reads the session from request headers, which do not exist outside a request.
vi.mock('@/lib/follows/resolve-viewer-follow-state', () => ({
  resolveFollowButtonState: vi.fn(async () => ({ isSignedIn: false, followedPilotIds: [] })),
}))

import { getClub } from '@/lib/flightlog/club'
import { getClubStats } from '@/lib/flightlog/club-stats'
import { getCountries } from '@/lib/flightlog/countries'
import { Club, generateMetadata, parseCanonicalClubId } from './page'

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

  // clubId gets the same canonical-decimal-string + isSafeInteger discipline as countryId
  // (see page.tsx's own parseCanonicalClubId doc comment) — each of these alias spellings
  // resolves to the exact same club under plain `Number()` coercion, so accepting them would
  // only multiply this route's own cache entries for no benefit.
  it.each(['0x33', '51.0', '1.6e2', '+51', ' 51 ', '999999999999999999999'])(
    'renders notFound for the clubId alias %j',
    async (alias) => {
      await expect(Club({ params: Promise.resolve({ countryId: '160', clubId: alias }) })).rejects.toMatchObject({
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      })
      expect(mockedGetClub).not.toHaveBeenCalled()
    },
  )

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
      roster: [{ userId: 1, name: 'Pilot One' }],
    })
    mockedGetClubStats.mockResolvedValue([{ name: 'Pilot One', flights: 14, distanceKm: 0, hours: 1.1 }])

    const element = await Club({ params: Promise.resolve({ countryId: '160', clubId: '51' }) })

    expect(mockedGetClub).toHaveBeenCalledWith(160, 51)
    // clubId only — never country_id — is #7's own explicit requirement for this fetcher's
    // signature (see club-stats.ts's own doc comment on why country_id is decorative and
    // omitting club_id silently returns a different club's stats).
    expect(mockedGetClubStats).toHaveBeenCalledWith(51)
    expect(element.props.countryName).toBe('Norway')
    expect(element.props.roster).toEqual([{ userId: 1, name: 'Pilot One' }])
    expect(element.props.stats).toEqual([{ name: 'Pilot One', flights: 14, distanceKm: 0, hours: 1.1 }])
  })
})

describe('parseCanonicalClubId', () => {
  it.each([
    ['51', 51],
    ['0', 0],
    ['0x33', null],
    ['51.0', null],
    ['+51', null],
    ['999999999999999999999', null],
  ])('parses %j to %s', (raw, expected) => {
    expect(parseCanonicalClubId(raw)).toBe(expected)
  })
})

describe('generateMetadata', () => {
  const metadataFor = (countryId: string, clubId: string) =>
    generateMetadata({ params: Promise.resolve({ countryId, clubId }) })

  it('titles with the club name and the country name, fetching by the parsed ids', async () => {
    mockedGetCountries.mockResolvedValue([
      { countryId: 160, name: 'Norway' },
      { countryId: 203, name: 'Sweden' },
    ])
    mockedGetClub.mockResolvedValue({
      detail: {
        clubId: 51,
        name: 'Voss Hang- Og Paragliderklubb',
        memberCount: 0,
        coordinatesText: null,
        mapUrl: null,
        description: null,
        linkUrl: null,
        createdAt: null,
        updatedAt: null,
      },
      roster: [],
    })

    expect(await metadataFor('203', '51')).toEqual({ title: 'Voss Hang- Og Paragliderklubb, Sweden' })
    expect(mockedGetClub).toHaveBeenCalledWith(203, 51)
    expect(mockedGetClubStats).not.toHaveBeenCalled()
  })

  it('renders notFound when getClub resolves null', async () => {
    mockedGetClub.mockResolvedValue(null)
    mockedGetCountries.mockResolvedValue([{ countryId: 160, name: 'Norway' }])

    await expect(metadataFor('160', '999999999')).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
  })

  it.each([
    ['abc', '51'],
    ['0', '51'],
    ['160.0', '51'],
    ['160', 'abc'],
    ['160', '0'],
    ['160', '51.0'],
  ])('renders notFound for countryId %j and clubId %j without fetching', async (countryId, clubId) => {
    await expect(metadataFor(countryId, clubId)).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
    expect(mockedGetClub).not.toHaveBeenCalled()
  })
})
