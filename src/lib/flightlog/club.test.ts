import { describe, expect, it, vi } from 'vitest'

// Same isolation reasoning as clubs.test.ts: mock server-only, next/cache, the network
// boundary (http.ts) and both parsers, so this test exercises only club.ts's own contract —
// the exact query string and referer it builds, how it wires the cache, and the cross-check
// between the two parsers' outputs that #7's fix round added (see getClub's own doc comment).
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }))
vi.mock('./http', () => ({
  fetchFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-club-detail', () => ({ parseClubDetail: vi.fn() }))
vi.mock('./parse-club-roster', () => ({ parseClubRoster: vi.fn() }))

import { cacheLife, cacheTag } from 'next/cache'
import { fetchFlightlogText } from './http'
import { parseClubDetail } from './parse-club-detail'
import { parseClubRoster } from './parse-club-roster'
import { getClub } from './club'
import type { ClubDetail } from './types'

const mockedFetch = vi.mocked(fetchFlightlogText)
const mockedParseClubDetail = vi.mocked(parseClubDetail)
const mockedParseClubRoster = vi.mocked(parseClubRoster)
const mockedCacheLife = vi.mocked(cacheLife)
const mockedCacheTag = vi.mocked(cacheTag)

const DETAIL: ClubDetail = {
  clubId: 51,
  name: 'Voss Hang- Og Paragliderklubb',
  memberCount: 1,
  coordinatesText: null,
  mapUrl: null,
  description: null,
  linkUrl: null,
  createdAt: null,
  updatedAt: null,
}

describe('getClub', () => {
  it('requests a=26 for the given country/club with the clubs-in-country referer, caches for hours under a per-club tag, and returns the parsed detail plus roster', async () => {
    mockedFetch.mockResolvedValue('<html>voss stub</html>')
    mockedParseClubDetail.mockReturnValue(DETAIL)
    mockedParseClubRoster.mockReturnValue([{ userId: 1, name: 'Ade Hawkins' }])

    const club = await getClub(160, 51)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=26&country_id=160&club_id=51', {
      referer: 'https://flightlog.org/fl.html?l=1&a=25&country_id=160',
    })
    expect(mockedParseClubDetail).toHaveBeenCalledWith('<html>voss stub</html>', 51)
    expect(mockedParseClubRoster).toHaveBeenCalledWith('<html>voss stub</html>', 51)
    expect(club).toEqual({ detail: DETAIL, roster: [{ userId: 1, name: 'Ade Hawkins' }] })
    expect(mockedCacheLife).toHaveBeenCalledWith('hours')
    expect(mockedCacheTag).toHaveBeenCalledWith('club-160-51')
  })

  it('keys the query string and the cache tag on the requested country/club, not fixed ones', async () => {
    mockedFetch.mockResolvedValue('<html>eiken stub</html>')
    mockedParseClubDetail.mockReturnValue({ ...DETAIL, clubId: 37, memberCount: 0 })
    mockedParseClubRoster.mockReturnValue([])

    await getClub(160, 37)

    expect(mockedFetch).toHaveBeenCalledWith('/fl.html?l=1&a=26&country_id=160&club_id=37', expect.anything())
    expect(mockedCacheTag).toHaveBeenCalledWith('club-160-37')
  })

  it('returns null for the 0-byte-body not-found signal without ever calling parseClubRoster', async () => {
    mockedFetch.mockResolvedValue('')
    mockedParseClubDetail.mockReturnValue(null)

    const club = await getClub(160, 999999999)

    expect(club).toBeNull()
    expect(mockedParseClubRoster).not.toHaveBeenCalled()
  })

  // #7's fix round: an upstream truncation mid-response can leave a fully-formed info block
  // (declaring the real memberCount) beside a partial roster — neither parser catches this on
  // its own (see club.ts's own doc comment), so getClub cross-checks the two halves against
  // each other. This must go RED for a roster silently short of the declared count, INCLUDING
  // the degenerate case of a roster parser that silently returns [] entirely for a club that
  // actually has members.
  it('throws when the roster is shorter than the info block declares, rather than rendering a partial roster as a complete club', async () => {
    mockedFetch.mockResolvedValue('<html>truncated stub</html>')
    mockedParseClubDetail.mockReturnValue({ ...DETAIL, memberCount: 1271 })
    mockedParseClubRoster.mockReturnValue([{ userId: 1, name: 'Ade Hawkins' }]) // 1 of 1271

    await expect(getClub(160, 51)).rejects.toThrow(/roster carries 1 member/)
  })

  it('throws when parseClubRoster returns an empty roster for a club the info block says has members', async () => {
    mockedFetch.mockResolvedValue('<html>stub</html>')
    mockedParseClubDetail.mockReturnValue({ ...DETAIL, memberCount: 1271 })
    mockedParseClubRoster.mockReturnValue([])

    await expect(getClub(160, 51)).rejects.toThrow(/roster carries 0 member/)
  })

  it('does not throw for a real, zero-member club where both halves agree on zero', async () => {
    mockedFetch.mockResolvedValue('<html>eiken stub</html>')
    mockedParseClubDetail.mockReturnValue({ ...DETAIL, memberCount: 0 })
    mockedParseClubRoster.mockReturnValue([])

    await expect(getClub(160, 37)).resolves.toEqual({ detail: { ...DETAIL, memberCount: 0 }, roster: [] })
  })
})
