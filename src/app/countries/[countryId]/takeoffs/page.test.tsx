import { describe, expect, it, vi } from 'vitest'

// The real fetchers import 'server-only', which throws on plain import outside a
// react-server bundling context — mocking the whole module (hoisted above these imports by
// Vitest) means that code never runs, so this test never touches the network. Same pattern
// the sibling Clubs route (../page.test.tsx) already uses for the same reason.
vi.mock('@/lib/flightlog/countries', () => ({ getCountries: vi.fn() }))
vi.mock('@/lib/flightlog/regions', () => ({ getRegions: vi.fn() }))

import { getCountries } from '@/lib/flightlog/countries'
import { getRegions } from '@/lib/flightlog/regions'
import TakeoffsPage, { TakeoffsWindParam } from './page'

const mockedGetCountries = vi.mocked(getCountries)
const mockedGetRegions = vi.mocked(getRegions)

const noSearchParams = Promise.resolve({})

describe('TakeoffsPage route guard', () => {
  it.each(['0', '-5', 'abc', '', '999'])(
    'renders notFound for a malformed or uncurated countryId %j, without calling either fetcher',
    async (countryId) => {
      await expect(
        TakeoffsPage({ params: Promise.resolve({ countryId }), searchParams: noSearchParams }),
      ).rejects.toMatchObject({
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      })
      expect(mockedGetCountries).not.toHaveBeenCalled()
      expect(mockedGetRegions).not.toHaveBeenCalled()
    },
  )

  // Every alias here normalises to 160 under plain `Number()` (and `Number.isInteger` is
  // true for all of them too), so a guard built on `Number()` + `Number.isInteger` alone
  // would render the directory for each — a distinct URL per alias, none of them prerendered.
  it.each(['0xA0', '0Xa0', '160.0', '1.6e2', '+160', ' 160 ', '160.', '\n160\t'])(
    'renders notFound for the alias %j even though it normalises to 160',
    async (alias) => {
      await expect(
        TakeoffsPage({ params: Promise.resolve({ countryId: alias }), searchParams: noSearchParams }),
      ).rejects.toMatchObject({
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      })
    },
  )

  it('fetches countries and regions and forwards the parsed id, the resolved country name, and region names (not bare ids) to the Suspense-wrapped directory', async () => {
    mockedGetCountries.mockResolvedValue([
      { countryId: 160, name: 'Norway' },
      { countryId: 203, name: 'Sweden' },
    ])
    mockedGetRegions.mockResolvedValue([
      { regionId: 6, name: 'Nordland', countryId: 160 },
      { regionId: 61, name: 'Møre og Romsdal', countryId: 160 },
    ])

    const element = await TakeoffsPage({ params: Promise.resolve({ countryId: '160' }), searchParams: noSearchParams })

    expect(mockedGetRegions).toHaveBeenCalledWith(160)
    // The page itself only wires the Suspense boundary around TakeoffsWindParam — the
    // searchParams-dependent part (initialWindFilter) is TakeoffsWindParam's own concern,
    // covered directly below, not re-derived here.
    const inner = element.props.children
    expect(inner.type).toBe(TakeoffsWindParam)
    expect(inner.props.countryId).toBe(160)
    expect(inner.props.countryName).toBe('Norway')
    expect(inner.props.regions).toEqual([
      { regionId: 6, name: 'Nordland' },
      { regionId: 61, name: 'Møre og Romsdal' },
    ])
  })

  it('falls back to a generic label when the resolved country id is absent from getCountries, rather than crashing', async () => {
    mockedGetCountries.mockResolvedValue([{ countryId: 203, name: 'Sweden' }])
    mockedGetRegions.mockResolvedValue([])

    const element = await TakeoffsPage({ params: Promise.resolve({ countryId: '160' }), searchParams: noSearchParams })

    expect(element.props.children.props.countryName).toBe('Country 160')
  })
})

describe('TakeoffsWindParam — validated ?wind= passthrough', () => {
  const baseProps = { countryId: 160, countryName: 'Norway', regions: [] }

  it('resolves to initialWindFilter "all" when no ?wind= param is present', async () => {
    const element = await TakeoffsWindParam({ ...baseProps, searchParams: Promise.resolve({}) })

    expect(element.props.initialWindFilter).toBe('all')
  })

  it.each(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'])('passes a valid ?wind=%s through as initialWindFilter', async (wind) => {
    const element = await TakeoffsWindParam({ ...baseProps, searchParams: Promise.resolve({ wind }) })

    expect(element.props.initialWindFilter).toBe(wind)
  })

  // The exact case wind.ts's assertOctant guard exists for: an untrusted, unvalidated string
  // from a URL query parameter must never reach the filter as-is.
  it('falls back to "all" for an invalid ?wind= value, rather than passing the raw string through', async () => {
    const element = await TakeoffsWindParam({ ...baseProps, searchParams: Promise.resolve({ wind: 'northwest' }) })

    expect(element.props.initialWindFilter).toBe('all')
  })

  it('treats a repeated ?wind= (an array) as no filter, rather than guessing which value was meant', async () => {
    const element = await TakeoffsWindParam({ ...baseProps, searchParams: Promise.resolve({ wind: ['N', 'S'] }) })

    expect(element.props.initialWindFilter).toBe('all')
  })

  it('forwards countryId, countryName and regions unchanged', async () => {
    const element = await TakeoffsWindParam({
      countryId: 160,
      countryName: 'Norway',
      regions: [{ regionId: 6, name: 'Nordland' }],
      searchParams: Promise.resolve({}),
    })

    expect(element.props.countryId).toBe(160)
    expect(element.props.countryName).toBe('Norway')
    expect(element.props.regions).toEqual([{ regionId: 6, name: 'Nordland' }])
  })
})
