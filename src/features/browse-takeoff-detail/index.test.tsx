import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import TakeoffDetailView from './index'
import type { Takeoff, TakeoffDetail, TakeoffFlight } from '@/lib/flightlog/types'

// Same reasoning as browse-country-takeoffs/index.test.tsx: the real TakeoffsMap mounts an
// actual maplibre-gl MapLibreMap against a canvas, which jsdom cannot provide. Stubbed here so
// this suite can assert WHETHER the map section renders (and what it's handed) without a real
// GL context.
vi.mock('@/components/takeoffs-map', () => ({
  TakeoffsMap: ({ takeoffs }: { takeoffs: Takeoff[] }) => (
    <div data-testid="stub-takeoffs-map">{takeoffs.length} takeoff(s) on the map</div>
  ),
}))

// TakeoffFlightRow (#219) is a client component whose whole row navigates via useRouter, rather
// than a plain <Link> the way its own Track cell used to be — this renders it outside a mounted
// Next.js app router, same fix #218 needed for its own index.test.tsx.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// config.ts carries 'server-only', which throws on a plain import outside a react-server
// bundling context (see takeoff-detail.test.ts's own fetcher mocks for the same reasoning) —
// this component only reads flightlogTakeoffUrl's return value, never the real implementation.
vi.mock('@/lib/flightlog/config', () => ({ flightlogTakeoffUrl: vi.fn(() => 'https://flightlog.org/stub') }))

const DETAIL: TakeoffDetail = {
  takeoffId: 179,
  name: 'Drammen, Solbergåsen',
  region: 'Buskerud',
  altitude: '401 meters asl',
  description: 'A fine site.',
  linkUrl: 'http://goo.gl/maps/eiVlQ',
  createdAt: null,
  updatedAt: '2023-04-09 18:21:29 Espen Åshammer',
  siteRecords: [{ recordClass: 'PG', pilotName: 'Mikael Benjamin Ulstrup', distanceKm: 196.9, tripId: 803981 }],
}

const FLIGHT: TakeoffFlight = {
  tripId: 1000946,
  userId: 3365,
  pilotName: 'Jarl Christian Kind',
  club: 'Pyongyang Freedom Fighters',
  glider: 'Gin Camino M',
  duration: '02:41',
  distanceKm: 28,
  note: 'Good flight',
  date: '2026-07-17',
  timeOfDay: '10:52',
}

const MAP_ENTRY: Takeoff = {
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

describe('TakeoffDetailView', () => {
  it('renders the name, region/altitude subtitle, description and site records', () => {
    render(
      <TakeoffDetailView
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        flights={[]}
        mapEntry={null}
        currentYear={2026}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    screen.getByRole('heading', { name: 'Drammen, Solbergåsen' })
    screen.getByText(/Buskerud.*401 meters asl/)
    screen.getByText('A fine site.')
    screen.getByText(/Mikael Benjamin Ulstrup/)
  })

  it('links every flight row\'s pilot with a follow button; the row itself (not a Track link) is now the /flights/[tripId] navigation target', () => {
    render(
      <TakeoffDetailView
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        flights={[FLIGHT]}
        mapEntry={null}
        currentYear={2026}
        isSignedIn
        followedPilotIds={[]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Jarl Christian Kind' }).getAttribute('href')).toBe('/pilots/3365')
    // getByRole throws if not found, so its return alone is the assertion. Exact name match, not
    // /follow/i — #219 gave the row itself role="button" too, and its own accessible name
    // includes "Follow" as part of the whole row's text, so a loose regex would match both.
    screen.getByRole('button', { name: 'Follow' })
    // #219: the flight row's own Track cell is plain text now that the whole row navigates
    // (see flight-row.test.tsx for the row-click/keydown coverage) — only the site record's
    // "View track" link remains a real link.
    const trackLinks = screen.getAllByRole('link', { name: 'View track' }).map((link) => link.getAttribute('href'))
    expect(trackLinks).not.toContain('/flights/1000946')
    expect(trackLinks).toContain('/flights/803981')
  })

  it('marks a flight row\'s follow button as already-followed when its pilot id is in followedPilotIds', () => {
    render(
      <TakeoffDetailView
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        flights={[FLIGHT]}
        mapEntry={null}
        currentYear={2026}
        isSignedIn
        followedPilotIds={[3365]}
      />,
    )

    screen.getByRole('button', { name: 'Following' })
  })

  it('renders a sign-in prompt instead of a follow button when signed out', () => {
    render(
      <TakeoffDetailView
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        flights={[FLIGHT]}
        mapEntry={null}
        currentYear={2026}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    // Exact name match, not /follow/i — the row itself also carries role="button" (#219), and
    // its own accessible name includes "Sign in to follow" as part of the whole row's text.
    expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull()
    screen.getByRole('link', { name: /sign in to follow/i })
  })

  it('renders the deliberate empty state, not an empty table, when there are no flights this year', () => {
    render(
      <TakeoffDetailView
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        flights={[]}
        mapEntry={null}
        currentYear={2026}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    expect(screen.queryByRole('table', { name: '' })).toBeNull()
    screen.getByText(/no flights recorded/i)
    screen.getByText(/2026 only/i)
  })

  it('renders the map when a known-location entry is supplied', () => {
    render(
      <TakeoffDetailView
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        flights={[]}
        mapEntry={MAP_ENTRY}
        currentYear={2026}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    expect(screen.getByTestId('stub-takeoffs-map').textContent).toBe('1 takeoff(s) on the map')
  })

  // #11's explicit rule: omit the map entirely (no placeholder either) when the takeoff has no
  // known location, rather than rendering TakeoffsMap's own directory-oriented "no takeoffs
  // with a recorded location" copy, which reads confusingly on a page about exactly one
  // takeoff.
  it('omits the map entirely when mapEntry is null, rather than rendering a placeholder', () => {
    render(
      <TakeoffDetailView
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        flights={[]}
        mapEntry={null}
        currentYear={2026}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    expect(screen.queryByTestId('stub-takeoffs-map')).toBeNull()
  })

  it('links back to the country takeoffs directory and out to flightlog.org', () => {
    render(
      <TakeoffDetailView
        countryId={160}
        countryName="Norway"
        detail={DETAIL}
        flights={[]}
        mapEntry={null}
        currentYear={2026}
        isSignedIn={false}
        followedPilotIds={[]}
      />,
    )

    expect(screen.getByRole('link', { name: /back to norway takeoffs/i }).getAttribute('href')).toBe(
      '/countries/160/takeoffs',
    )
    screen.getByRole('link', { name: /view on flightlog.org/i })
  })
})
