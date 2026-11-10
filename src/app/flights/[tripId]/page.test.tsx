import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SCORING_KINDS } from '@/lib/flightlog/types'
import type { ScoringGeometryKind, ScoringGeometryResult, Track, FlightDetail } from '@/lib/flightlog/types'

// Mocking the whole module (hoisted above these imports by Vitest) means the real 'server-only'
// fetchers never run, same reasoning as the sibling takeoffs/[takeoffId]/page.test.tsx.
vi.mock('@/lib/flightlog/tracks', () => ({ getTrack: vi.fn(), hasTrack: vi.fn() }))
vi.mock('@/lib/flightlog/flight-detail', () => ({ getFlightDetail: vi.fn() }))
vi.mock('@/lib/flightlog/config', () => ({ flightlogFlightUrl: vi.fn(() => 'https://flightlog.org/stub') }))
// FlightTrack renders a real maplibre map against a canvas jsdom can't provide (see that
// component's own test suite for why it's stubbed there too) — this suite only cares about
// whether Flight decides to render it at all, not its internals.
vi.mock('@/features/show-flight-track', () => ({
  default: ({ track, distanceKm }: { track: Track; distanceKm?: number | null }) => (
    <div data-testid="flight-track" data-distance-km={String(distanceKm)}>
      track {track.tripId}
    </div>
  ),
}))
// CommentsOnFlight is an async server component that talks to the database — irrelevant to what
// Flight decides to render around it, so it's replaced with a synchronous marker.
vi.mock('@/features/comment-on-flight', () => ({
  default: ({ tripId }: { tripId: number }) => <div data-testid="comments-on-flight">comments {tripId}</div>,
}))

import { getTrack, hasTrack } from '@/lib/flightlog/tracks'
import { getFlightDetail } from '@/lib/flightlog/flight-detail'
import { Flight, generateMetadata } from './page'

const mockedGetTrack = vi.mocked(getTrack)
const mockedHasTrack = vi.mocked(hasTrack)
const mockedGetFlightDetail = vi.mocked(getFlightDetail)

const STUB_DETAIL = {
  tripId: 123,
  date: '2026-07-21',
  country: 'Norway',
  takeoff: 'Voss, Hjelle/Gjelle',
  takeoffRef: { countryId: 160, takeoffId: 133 },
  glider: 'Skywalk Mescal 6',
  duration: '00:06',
  distanceKm: null,
  maxAltitude: null,
  description: 'Min første høydetur',
  takeoffType: 'mountain',
  pilot: { name: 'Pilot One', userId: 900001 },
}

const EMPTY_SCORING = Object.fromEntries(SCORING_KINDS.map((kind) => [kind, null])) as Record<
  ScoringGeometryKind,
  ScoringGeometryResult
>

function stubTrack(tripId: number): Track {
  return { tripId, points: [], stats: 'unparseable', scoring: EMPTY_SCORING }
}

describe('Flight', () => {
  // #213/#215: most flights on a pilot's logbook have no GPS track, and parseTrack (via
  // getTrack) deliberately throws when a trip has no track placemark at all. Checking hasTrack
  // first is what keeps that throw meaningful — this pins that getTrack is never even called
  // for an untracked trip, not just that the page happens not to crash. #215 replaced the old
  // bare "no track" notice with flightlog.org's own a=34 detail table (see the tests below), so
  // this now pins the fetch/skip contract only.
  it('skips getTrack and calls getFlightDetail when hasTrack is false', async () => {
    mockedHasTrack.mockResolvedValue(false)
    mockedGetFlightDetail.mockResolvedValue(STUB_DETAIL)

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    expect(mockedHasTrack).toHaveBeenCalledWith(123)
    expect(mockedGetTrack).not.toHaveBeenCalled()
    expect(mockedGetFlightDetail).toHaveBeenCalledWith(123)
    expect(screen.queryByTestId('flight-track')).toBeNull()
  })

  it('fetches the track and the a=34 detail when hasTrack is true, passing distanceKm to FlightTrack', async () => {
    mockedHasTrack.mockResolvedValue(true)
    mockedGetTrack.mockResolvedValue(stubTrack(123))
    mockedGetFlightDetail.mockResolvedValue({ ...STUB_DETAIL, distanceKm: 212 })

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    expect(mockedGetTrack).toHaveBeenCalledWith(123)
    expect(mockedGetFlightDetail).toHaveBeenCalledWith(123)
    expect(screen.getByTestId('flight-track').getAttribute('data-distance-km')).toBe('212')
  })

  describe('tracked flight heading', () => {
    async function renderTracked(detail: FlightDetail | null) {
      mockedHasTrack.mockResolvedValue(true)
      mockedGetTrack.mockResolvedValue(stubTrack(123))
      mockedGetFlightDetail.mockResolvedValue(detail)
      render(await Flight({ params: Promise.resolve({ tripId: '123' }) }))
      return screen.getByRole('heading', { level: 1 })
    }

    it('renders pilot, takeoff and date, in that order, with the pilot and takeoff linked', async () => {
      const h1 = await renderTracked({ ...STUB_DETAIL, date: '2022-07-29 11:36' })

      const links = within(h1).getAllByRole('link')
      expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
        ['Pilot One', '/pilots/900001'],
        ['Voss, Hjelle/Gjelle', '/countries/160/takeoffs/133'],
      ])
      const text = h1.textContent!
      expect(text.indexOf('Pilot One')).toBeLessThan(text.indexOf('Voss, Hjelle/Gjelle'))
      expect(text.indexOf('Voss, Hjelle/Gjelle')).toBeLessThan(text.indexOf('2022'))
      expect(within(h1).queryByText(/Flight 123/)).toBeNull()
    })

    it.each(['2022-07-29 11:36', '2022-07-29'])('renders the date %s', async (date) => {
      const h1 = await renderTracked({ ...STUB_DETAIL, date })
      expect(h1.textContent).toMatch(/2022/)
    })

    it('renders the takeoff as plain text when takeoffRef is null', async () => {
      const h1 = await renderTracked({ ...STUB_DETAIL, takeoffRef: null })
      expect(within(h1).getAllByRole('link').map((link) => link.textContent)).toEqual(['Pilot One'])
      expect(h1.textContent).toContain('Voss, Hjelle/Gjelle')
    })

    it.each([
      ['pilot', { pilot: null }, 'Pilot One'],
      ['takeoff', { takeoff: null, takeoffRef: null }, 'Voss'],
      ['date', { date: null }, '2026'],
    ])('omits a null %s', async (_part, override, absentText) => {
      const h1 = await renderTracked({ ...STUB_DETAIL, ...override })
      expect(h1.textContent).not.toContain(absentText)
      expect(h1.textContent).not.toMatch(/Flight 123/)
    })

    it('falls back to "Flight {id}" when pilot, takeoff and date are all null', async () => {
      const h1 = await renderTracked({ ...STUB_DETAIL, pilot: null, takeoff: null, takeoffRef: null, date: null })
      expect(h1.textContent).toBe('Flight 123')
    })

    it('keeps the flightlog.org link in the header', async () => {
      await renderTracked(STUB_DETAIL)
      expect(screen.getByRole('link', { name: /View on flightlog.org/ }).getAttribute('href')).toBe('https://flightlog.org/stub')
    })
  })

  describe('tracked flight when the a=34 detail is unavailable', () => {
    it.each([
      ['rejects', () => mockedGetFlightDetail.mockRejectedValue(new Error('parse failure'))],
      ['returns null', () => mockedGetFlightDetail.mockResolvedValue(null)],
    ])('still renders the track with the bare heading when getFlightDetail %s', async (_case, arrange) => {
      mockedHasTrack.mockResolvedValue(true)
      mockedGetTrack.mockResolvedValue(stubTrack(123))
      arrange()

      render(await Flight({ params: Promise.resolve({ tripId: '123' }) }))

      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Flight 123')
      expect(screen.getByTestId('flight-track').getAttribute('data-distance-km')).toBe('undefined')
      screen.getByRole('link', { name: /View on flightlog.org/ })
    })
  })

  it('keeps the bare "Flight {id}" heading for an untracked flight, with no pilot', async () => {
    mockedHasTrack.mockResolvedValue(false)
    mockedGetFlightDetail.mockResolvedValue(STUB_DETAIL)

    render(await Flight({ params: Promise.resolve({ tripId: '123' }) }))

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Flight 123')
    expect(screen.queryByText('Pilot One')).toBeNull()
  })

  // #215's own feature: flightlog.org's own a=34 detail table rendered in place of the old bare
  // notice, for an untracked trip that DOES have a real flight-detail record.
  it('renders the flight detail table when hasTrack is false and getFlightDetail succeeds', async () => {
    mockedHasTrack.mockResolvedValue(false)
    mockedGetFlightDetail.mockResolvedValue(STUB_DETAIL)

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    screen.getByText('Voss, Hjelle/Gjelle')
    screen.getByText('Skywalk Mescal 6')
    screen.getByText('mountain')
    screen.getByText('Min første høydetur')
    expect(screen.queryByTestId('flight-track')).toBeNull()
  })

  // The Takeoff cell links into this app's own takeoff detail page via the parsed takeoffRef,
  // not a raw flightlog.org URL — same internal-navigation convention
  // browse-takeoff-detail/index.tsx's own SiteRecords already uses for a trip_id link.
  it("links the detail table's Takeoff value to this app's own takeoff detail page", async () => {
    mockedHasTrack.mockResolvedValue(false)
    mockedGetFlightDetail.mockResolvedValue(STUB_DETAIL)

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    expect(screen.getByRole('link', { name: 'Voss, Hjelle/Gjelle' }).getAttribute('href')).toBe('/countries/160/takeoffs/133')
  })

  // A trip with neither a GPS track nor an a=34 record does not exist — see parseFlightDetail's
  // own doc comment on why getFlightDetail returning null is flightlog.org's own positive "no
  // such trip_id" signal, not a scrape failure to swallow into some fallback UI.
  it('renders notFound when hasTrack is false and getFlightDetail returns null', async () => {
    mockedHasTrack.mockResolvedValue(false)
    mockedGetFlightDetail.mockResolvedValue(null)

    await expect(Flight({ params: Promise.resolve({ tripId: '123' }) })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    })
  })

  it.each([true, false])('renders CommentsOnFlight regardless of hasTrack (hasTrack=%s)', async (tracked) => {
    mockedHasTrack.mockResolvedValue(tracked)
    if (tracked) {
      mockedGetTrack.mockResolvedValue(stubTrack(123))
    } else {
      mockedGetFlightDetail.mockResolvedValue(STUB_DETAIL)
    }

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    render(element)

    screen.getByTestId('comments-on-flight')
  })

  it('shows a trailing icon on the "View on flightlog.org" link', async () => {
    mockedHasTrack.mockResolvedValue(false)
    mockedGetFlightDetail.mockResolvedValue(STUB_DETAIL)

    const element = await Flight({ params: Promise.resolve({ tripId: '123' }) })
    const { container } = render(element)

    expect(container.querySelector('a svg')).toBeTruthy()
  })
})

describe('generateMetadata', () => {
  const metadataFor = (tripId: string) => generateMetadata({ params: Promise.resolve({ tripId }) })

  it.each(['abc', '0', '-1', '1.5'])('renders notFound for the malformed id %j without fetching detail', async (tripId) => {
    await expect(metadataFor(tripId)).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
    expect(mockedGetFlightDetail).not.toHaveBeenCalled()
  })

  it('titles with pilot and takeoff, fetching detail by the parsed numeric id', async () => {
    mockedGetFlightDetail.mockResolvedValue(STUB_DETAIL)

    expect(await metadataFor('123')).toEqual({ title: 'Pilot One, Voss, Hjelle/Gjelle' })
    expect(mockedGetFlightDetail).toHaveBeenCalledWith(123)
  })

  it('omits the pilot when the detail has none', async () => {
    mockedGetFlightDetail.mockResolvedValue({ ...STUB_DETAIL, pilot: null })

    expect(await metadataFor('123')).toEqual({ title: 'Voss, Hjelle/Gjelle' })
  })

  it('falls back to `Flight <id>` when the detail is null, never notFound', async () => {
    mockedGetFlightDetail.mockResolvedValue(null)

    expect(await metadataFor('123')).toEqual({ title: 'Flight 123' })
  })

  it('falls back to `Flight <id>` when the detail has neither pilot nor takeoff', async () => {
    mockedGetFlightDetail.mockResolvedValue({ ...STUB_DETAIL, pilot: null, takeoff: null })

    expect(await metadataFor('123')).toEqual({ title: 'Flight 123' })
  })

  it('falls back to `Flight <id>` when the detail fetch throws, so a tracked flight is never 404ed', async () => {
    mockedGetFlightDetail.mockRejectedValue(new Error('scrape failed'))

    expect(await metadataFor('123')).toEqual({ title: 'Flight 123' })
  })
})
