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
import {
  isValidSearchQuery,
  MAX_QUERY_LENGTH,
  MIN_SIGNIFICANT_QUERY_LENGTH,
  searchPilots,
} from './pilot-search'

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
  ])(`rejects %j (below the ${MIN_SIGNIFICANT_QUERY_LENGTH}-character floor once measured as a run)`, (query, expected) => {
    expect(isValidSearchQuery(query)).toBe(expected)
  })

  it.each([
    ['abc', true], // exactly MIN_SIGNIFICANT_QUERY_LENGTH adjacent characters, one run
    ['nde', true], // the live-verified 3-char substring from docs/flightlog-api.md
    ['H_nden', true], // wildcard-narrowed real feature — splits to runs of 1 and 4, longest clears the floor
    ['a_b', false], // splits to runs of 1 and 1 — the longest run is 1, even though 2 characters survive the strip
  ])('for %j, the longest run of adjacent characters gives isValidSearchQuery() = %s', (query, expected) => {
    expect(isValidSearchQuery(query)).toBe(expected)
  })

  // B1: `%` removes the adjacency requirement, so a query that only strips to N significant
  // characters — without any N of them being adjacent — carries none of the narrowing power
  // that justifies the floor. These are all real full-table-scan shapes: `nde` returns 404/407
  // rows in the fixture (adjacent, correctly accepted above); these strip to the same 3
  // characters but scattered, and return far more (up to 242/407, 59% of the cohort).
  it.each([
    ['n%d%e', false], // a strict superset of the accepted `nde` query — must not slip through
    ['e%r%n', false],
    ['a%e%o', false],
  ])('rejects %j — 3 significant characters but no adjacent run of 3, so it is not narrowing like `nde`', (query, expected) => {
    expect(isValidSearchQuery(query)).toBe(expected)
  })

  // Guard order of operations: a wildcard must not shield whitespace from the floor. Splitting
  // on the wildcard first (rather than trimming the whole query first) is what makes this reject
  // rather than accept — trimming first would leave `%   %` untouched (it doesn't start or end
  // with whitespace) and then stripping `%` would hand the old total-length count 3 raw spaces.
  it('rejects a query padded with wildcards around pure whitespace, e.g. `%   %`', () => {
    expect(isValidSearchQuery('%   %')).toBe(false)
  })

  it('rejects a query longer than MAX_QUERY_LENGTH, to bound the POST body a caller can trigger', () => {
    expect(MAX_QUERY_LENGTH).toBe(100)
    expect(isValidSearchQuery('a'.repeat(MAX_QUERY_LENGTH))).toBe(true)
    expect(isValidSearchQuery('a'.repeat(MAX_QUERY_LENGTH + 1))).toBe(false)
    expect(isValidSearchQuery('a'.repeat(100000))).toBe(false)
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

  it('sends % and _ verbatim in the body — they are live SQL LIKE wildcards, not characters to sanitise away', async () => {
    mockedPost.mockResolvedValue('<html></html>')
    mockedParse.mockReturnValue([])

    await searchPilots('H_nden')

    expect(mockedPost).toHaveBeenCalledWith(
      '/fl.html?l=1&a=114',
      'form=find_user&user_fullname=H_nden&go=Go',
      expect.anything(),
    )
  })

  it('trims the query once and sends that same trimmed value in the body — the guard and the payload must agree', async () => {
    mockedPost.mockResolvedValue('<html></html>')
    mockedParse.mockReturnValue([])

    const results = await searchPilots('  abc  ')

    // If the guard measured the trimmed query but the body sent the raw one, this would have
    // gone out as `user_fullname=++abc++` instead — same string the guard validated, on the wire.
    expect(mockedPost).toHaveBeenCalledWith(
      '/fl.html?l=1&a=114',
      'form=find_user&user_fullname=abc&go=Go',
      expect.anything(),
    )
    expect(results).toEqual([])
  })
})
