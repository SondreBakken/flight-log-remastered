import { describe, expect, it, vi } from 'vitest'

// pilot-search.ts imports 'server-only' directly — mock it, plus http.ts (the network
// boundary) and parse-pilot-search.ts, so this test exercises only pilot-search.ts's own
// contract: the query guard, the request it builds, and how it wires the parser. Same shape
// as clubs.test.ts's mocking of ./http and ./parse-clubs.
vi.mock('server-only', () => ({}))
vi.mock('./http', () => ({
  postFlightlogText: vi.fn(),
  FLIGHTLOG_ORIGIN: 'https://flightlog.org',
}))
vi.mock('./parse-pilot-search', () => ({ parsePilotSearch: vi.fn() }))

import { postFlightlogText } from './http'
import { parsePilotSearch } from './parse-pilot-search'
import { isValidSearchQuery, MIN_SIGNIFICANT_QUERY_LENGTH, searchPilots } from './pilot-search'

const mockedPost = vi.mocked(postFlightlogText)
const mockedParse = vi.mocked(parsePilotSearch)

describe('isValidSearchQuery', () => {
  it.each([
    ['', false],
    ['%', false],
    ['%%', false],
    ['_', false],
    ['__', false],
    ['a', false],
    ['ab', false],
    ['   ', false], // whitespace only, no significant characters
    ['%%%', false], // 3 raw characters (== the floor) but 0 significant — must not slip through on raw length
    ['___', false], // same, with the other wildcard
  ])('rejects %j (below the %i-character floor once wildcards are stripped)', (query, expected) => {
    expect(isValidSearchQuery(query)).toBe(expected)
  })

  it.each([
    ['abc', true], // exactly MIN_SIGNIFICANT_QUERY_LENGTH real characters
    ['nde', true], // the live-verified 3-char substring from docs/flightlog-api.md
    ['H_nden', true], // wildcard-narrowed real feature — 5 significant chars, must stay valid
    ['a_b', false], // 2 significant chars even though the raw string is 3 long
  ])('for %j, stripping wildcards before counting gives isValidSearchQuery() = %s', (query, expected) => {
    expect(isValidSearchQuery(query)).toBe(expected)
  })

  it('exposes the exact floor it enforces, so a caller can render "type N more characters"', () => {
    expect(MIN_SIGNIFICANT_QUERY_LENGTH).toBe(3)
  })
})

describe('searchPilots', () => {
  it('never reaches the network for a query below the significant-length floor', async () => {
    const results = await searchPilots('%')

    expect(mockedPost).not.toHaveBeenCalled()
    expect(mockedParse).not.toHaveBeenCalled()
    expect(results).toEqual([])
  })

  it('POSTs the a=114 path with form=find_user/user_fullname/go, the a=114 page as referer, and returns the parsed results', async () => {
    mockedPost.mockResolvedValue('<html>results stub</html>')
    mockedParse.mockReturnValue([{ userId: 754, name: 'Nils Aage Henden', country: 'Norway' }])

    const results = await searchPilots('Henden')

    expect(mockedPost).toHaveBeenCalledWith(
      '/fl.html?l=1&a=114',
      'form=find_user&user_fullname=Henden&go=Go',
      { referer: 'https://flightlog.org/fl.html?l=1&a=114' },
    )
    expect(mockedParse).toHaveBeenCalledWith('<html>results stub</html>')
    expect(results).toEqual([{ userId: 754, name: 'Nils Aage Henden', country: 'Norway' }])
  })

  it('percent-encodes a non-ASCII query (å, ø, æ) the way URLSearchParams does, not raw', async () => {
    mockedPost.mockResolvedValue('<html></html>')
    mockedParse.mockReturnValue([])

    await searchPilots('Åge Ødegård')

    expect(mockedPost).toHaveBeenCalledWith(
      '/fl.html?l=1&a=114',
      'form=find_user&user_fullname=%C3%85ge+%C3%98deg%C3%A5rd&go=Go',
      expect.anything(),
    )
  })
})
