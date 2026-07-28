import { describe, expect, it, vi } from 'vitest'

// Same reasoning as the sibling directory's page.test.tsx: mocking the whole module (hoisted
// above these imports by Vitest) means the real 'server-only' fetchers never run, so this test
// never touches the network.
vi.mock('@/lib/flightlog/countries', () => ({ getCountries: vi.fn() }))
vi.mock('@/lib/flightlog/takeoff-detail', () => ({ getTakeoffDetail: vi.fn() }))
vi.mock('@/lib/flightlog/takeoff-flights', () => ({ getTakeoffFlights: vi.fn() }))
vi.mock('@/lib/flightlog/takeoffs', () => ({ getTakeoffs: vi.fn() }))
// TakeoffDetailView (the view component page.tsx renders into) imports config.ts's own
// 'server-only' flightlogTakeoffUrl — mocked for the same reason as the fetchers above: this
// test renders the returned React element's props without ever calling react-dom, so the real
// implementation is never needed, only importable without crashing.
vi.mock('@/lib/flightlog/config', () => ({ flightlogTakeoffUrl: vi.fn(() => 'https://flightlog.org/stub') }))

import { getCountries } from '@/lib/flightlog/countries'
import { getTakeoffDetail } from '@/lib/flightlog/takeoff-detail'
import { getTakeoffFlights } from '@/lib/flightlog/takeoff-flights'
import { getTakeoffs } from '@/lib/flightlog/takeoffs'
import { TakeoffDetail } from './page'

const mockedGetCountries = vi.mocked(getCountries)
const mockedGetTakeoffDetail = vi.mocked(getTakeoffDetail)
const mockedGetTakeoffFlights = vi.mocked(getTakeoffFlights)
const mockedGetTakeoffs = vi.mocked(getTakeoffs)

const STUB_DETAIL = {
  takeoffId: 179,
  name: 'Drammen, Solbergåsen',
  region: 'Buskerud',
  altitude: '401 meters asl',
  description: 'stub description',
  linkUrl: null,
  createdAt: null,
  updatedAt: null,
  siteRecords: [],
}

const KNOWN_LOCATION_TAKEOFF = {
  takeoffId: 179,
  name: 'Drammen, Solbergåsen',
  lat: 59.77,
  lon: 10.05,
  wind: 56,
  countryId: 160,
  regionId: 6,
  subregionId: 0,
  altitude: 401,
  altitudeDiff: 3,
}

describe('TakeoffDetail route guard', () => {
  it.each(['0', '-5', 'abc', '', '999'])(
    'renders notFound for a malformed or uncurated countryId %j, without calling any fetcher',
    async (countryId) => {
      await expect(
        TakeoffDetail({ params: Promise.resolve({ countryId, takeoffId: '179' }) }),
      ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
      expect(mockedGetTakeoffDetail).not.toHaveBeenCalled()
      expect(mockedGetTakeoffFlights).not.toHaveBeenCalled()
      expect(mockedGetTakeoffs).not.toHaveBeenCalled()
      expect(mockedGetCountries).not.toHaveBeenCalled()
    },
  )

  it.each(['0', '-5', 'abc', '', '1.5'])(
    'renders notFound for a malformed takeoffId %j on an otherwise-curated country, without calling any fetcher',
    async (takeoffId) => {
      await expect(
        TakeoffDetail({ params: Promise.resolve({ countryId: '160', takeoffId }) }),
      ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
      expect(mockedGetTakeoffDetail).not.toHaveBeenCalled()
    },
  )

  // The one case that actually needs a real fetch: getTakeoffDetail's null return (a
  // nonexistent start_id — see parseTakeoffDetail's own doc comment) must 404, even though
  // getTakeoffFlights for that same id would have happily returned an empty (not thrown)
  // array — this is exactly the "row emptiness alone cannot tell the two apart" case #11
  // exists to guard.
  it('renders notFound when getTakeoffDetail returns null, regardless of what getTakeoffFlights returns', async () => {
    mockedGetCountries.mockResolvedValue([{ countryId: 160, name: 'Norway' }])
    mockedGetTakeoffDetail.mockResolvedValue(null)
    mockedGetTakeoffFlights.mockResolvedValue([])
    mockedGetTakeoffs.mockResolvedValue([])

    await expect(
      TakeoffDetail({ params: Promise.resolve({ countryId: '160', takeoffId: '999999999' }) }),
    ).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
  })

  // #11's cross-check: a=42's own identity signal (null — see parseTakeoffFlights) reporting
  // "no such takeoff" while a=22 just confirmed the opposite is a genuine inconsistency between
  // two independently-cached responses, not the ordinary 404 path above (which already returns
  // before this check runs).
  it('throws when getTakeoffFlights reports no such takeoff but getTakeoffDetail confirms it exists', async () => {
    mockedGetCountries.mockResolvedValue([{ countryId: 160, name: 'Norway' }])
    mockedGetTakeoffDetail.mockResolvedValue(STUB_DETAIL)
    mockedGetTakeoffFlights.mockResolvedValue(null)
    mockedGetTakeoffs.mockResolvedValue([])

    await expect(TakeoffDetail({ params: Promise.resolve({ countryId: '160', takeoffId: '179' }) })).rejects.toThrow(
      /a=42 reports no such takeoff/,
    )
  })

  it('fetches all four sources in parallel and forwards the resolved country name, detail and flights to the view', async () => {
    mockedGetCountries.mockResolvedValue([
      { countryId: 160, name: 'Norway' },
      { countryId: 203, name: 'Sweden' },
    ])
    mockedGetTakeoffDetail.mockResolvedValue(STUB_DETAIL)
    mockedGetTakeoffFlights.mockResolvedValue([])
    mockedGetTakeoffs.mockResolvedValue([KNOWN_LOCATION_TAKEOFF])

    const element = await TakeoffDetail({ params: Promise.resolve({ countryId: '160', takeoffId: '179' }) })

    expect(mockedGetTakeoffDetail).toHaveBeenCalledWith(160, 179)
    expect(mockedGetTakeoffFlights).toHaveBeenCalledWith(160, 179)
    expect(mockedGetTakeoffs).toHaveBeenCalledWith(160)
    expect(element.props.countryId).toBe(160)
    expect(element.props.countryName).toBe('Norway')
    expect(element.props.detail).toEqual(STUB_DETAIL)
    expect(element.props.flights).toEqual([])
    expect(element.props.mapEntry).toEqual(KNOWN_LOCATION_TAKEOFF)
  })

  it('falls back to a generic country label when the resolved country id is absent from getCountries', async () => {
    mockedGetCountries.mockResolvedValue([{ countryId: 203, name: 'Sweden' }])
    mockedGetTakeoffDetail.mockResolvedValue(STUB_DETAIL)
    mockedGetTakeoffFlights.mockResolvedValue([])
    mockedGetTakeoffs.mockResolvedValue([])

    const element = await TakeoffDetail({ params: Promise.resolve({ countryId: '160', takeoffId: '179' }) })

    expect(element.props.countryName).toBe('Country 160')
  })

  // #11's explicit rule, exercised end to end at the route level: a takeoff absent from the
  // country's rqtid=11 dataset (never fetched into `takeoffs` at all) gets no map, same as one
  // present but excluded by hasKnownLocation below.
  it('omits the map (mapEntry: null) when the takeoff is absent from the country takeoffs dataset', async () => {
    mockedGetCountries.mockResolvedValue([{ countryId: 160, name: 'Norway' }])
    mockedGetTakeoffDetail.mockResolvedValue(STUB_DETAIL)
    mockedGetTakeoffFlights.mockResolvedValue([])
    mockedGetTakeoffs.mockResolvedValue([])

    const element = await TakeoffDetail({ params: Promise.resolve({ countryId: '160', takeoffId: '179' }) })

    expect(element.props.mapEntry).toBeNull()
  })

  // The corruption shapes #11 measured: the full Null Island placeholder (lat=lon=0) and a
  // lat/lon axis swap both still appear as a ROW in the rqtid=11 dataset — hasKnownLocation is
  // what excludes them, not their absence from the dataset (see page.tsx's own doc comment on
  // why there is no a=22 coordinate fallback to fall back to instead).
  it('omits the map (mapEntry: null) for a takeoff present in the dataset but excluded by hasKnownLocation', async () => {
    mockedGetCountries.mockResolvedValue([{ countryId: 160, name: 'Norway' }])
    mockedGetTakeoffDetail.mockResolvedValue(STUB_DETAIL)
    mockedGetTakeoffFlights.mockResolvedValue([])
    mockedGetTakeoffs.mockResolvedValue([{ ...KNOWN_LOCATION_TAKEOFF, lat: 0, lon: 0 }])

    const element = await TakeoffDetail({ params: Promise.resolve({ countryId: '160', takeoffId: '179' }) })

    expect(element.props.mapEntry).toBeNull()
  })
})
