import { describe, expect, it, vi } from 'vitest'

// pilot-search.ts imports 'server-only' directly, which throws on plain import outside a
// react-server bundling context — mock it so importActual below (needed to keep the real
// isValidSearchQuery/MIN_SIGNIFICANT_QUERY_LENGTH, only stubbing searchPilots itself) doesn't
// trip that guard. Same shape as countries/[countryId]/page.test.tsx's mocking of
// getClubs/getCountries, one level deeper because this route also exercises the real guard.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/flightlog/pilot-search', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flightlog/pilot-search')>(
    '@/lib/flightlog/pilot-search',
  )
  return { ...actual, searchPilots: vi.fn() }
})

import { searchPilots } from '@/lib/flightlog/pilot-search'
import { Search } from './page'

const mockedSearchPilots = vi.mocked(searchPilots)

describe('Search route guard', () => {
  it.each([undefined, '', '  ', '%', '_', 'ab'])(
    'renders with results=null for query %j, without calling searchPilots',
    async (q) => {
      const element = await Search({ searchParams: Promise.resolve({ q }) })

      expect(mockedSearchPilots).not.toHaveBeenCalled()
      expect(element.props.results).toBeNull()
    },
  )

  it('treats a non-string q (e.g. a repeated ?q= in the URL) as no query, rather than guessing which value was meant', async () => {
    const element = await Search({ searchParams: Promise.resolve({ q: ['abc', 'def'] }) })

    expect(mockedSearchPilots).not.toHaveBeenCalled()
    expect(element.props.query).toBe('')
  })

  it('calls searchPilots and passes its results through once the query clears the guard', async () => {
    mockedSearchPilots.mockResolvedValue({
      kind: 'results',
      results: [{ userId: 754, name: 'Nils Aage Henden', country: 'Norway' }],
    })

    const element = await Search({ searchParams: Promise.resolve({ q: 'Henden' }) })

    expect(mockedSearchPilots).toHaveBeenCalledWith('Henden')
    expect(element.props.query).toBe('Henden')
    expect(element.props.results).toEqual([{ userId: 754, name: 'Nils Aage Henden', country: 'Norway' }])
  })

  // The bug this fix targets: a query matching exactly one pilot must land on that pilot's own
  // page, mirroring flightlog.org's own a=114 behavior (a real browser submitting this search
  // ends up on the matched pilot's profile too, not a one-result results page) — see
  // pilot-search.ts's searchPilots and its 'single-match' outcome.
  it('redirects to the matched pilot\'s page for a single-match outcome, without rendering results', async () => {
    mockedSearchPilots.mockResolvedValue({ kind: 'single-match', userId: 11348 })

    await expect(Search({ searchParams: Promise.resolve({ q: 'viljar' }) })).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;replace;/pilots/11348;307;',
    })
  })
})
