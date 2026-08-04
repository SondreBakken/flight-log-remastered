import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { FlownSite, UnmatchedSite } from './join-flown-sites'

// Same reasoning as browse-takeoff-detail/index.test.tsx: the real FlownSitesMap mounts an
// actual maplibre-gl MapLibreMap against a canvas, which jsdom cannot provide. Stubbed so this
// suite can assert WHETHER the map renders (and what it's handed) without a real GL context —
// the map canvas itself is verify-script territory (scripts/verify-flown-sites.mts).
vi.mock('@/components/flown-sites-map', () => ({
  FlownSitesMap: ({ sites }: { sites: FlownSite[] }) => <div data-testid="stub-flown-sites-map">{sites.length} site(s) on the map</div>,
}))

// fetch-flown-sites.ts carries 'server-only' (throws on a plain import outside a react-server
// bundling context) — mocked so this suite drives FlownSitesSection through every result state
// directly, without a real flightlog.org fetch or 'use cache' semantics.
vi.mock('./fetch-flown-sites', () => ({ getFlownSites: vi.fn() }))

import { getFlownSites } from './fetch-flown-sites'
import FlownSitesSection from './index'

const mockedGetFlownSites = vi.mocked(getFlownSites)

function site(overrides: Partial<FlownSite> = {}): FlownSite {
  return { takeoffId: 15, countryId: 160, name: 'Bismo (Riksanlegget)', lat: 61.6, lon: 8.5, flightCount: 3, ...overrides }
}

function unmatched(overrides: Partial<UnmatchedSite> = {}): UnmatchedSite {
  return { name: 'Laragne, Chabre', reason: 'uncurated-country', flightCount: 1, ...overrides }
}

async function renderSection() {
  render(await FlownSitesSection({ userId: 4549 }))
}

describe('FlownSitesSection', () => {
  it('renders a visible load-failure message for the error state, distinct from an empty section', async () => {
    mockedGetFlownSites.mockResolvedValue({ status: 'error', message: 'flightlog.org returned 502' })

    await renderSection()

    screen.getByText('Flown sites could not be loaded:')
    screen.getByText('flightlog.org returned 502')
    expect(screen.queryByTestId('stub-flown-sites-map')).toBeNull()
  })

  it('renders the "no flights" state distinctly, without a summary line or a map', async () => {
    mockedGetFlownSites.mockResolvedValue({ status: 'no-flights' })

    await renderSection()

    screen.getByText(/flown sites will appear once this pilot has logged flights/)
    expect(screen.queryByTestId('stub-flown-sites-map')).toBeNull()
    expect(screen.queryByText(/sites mapped/)).toBeNull()
  })

  it('renders the map and a plain summary when every takeoff matched (no unmatched clause)', async () => {
    mockedGetFlownSites.mockResolvedValue({ status: 'loaded', sites: [site(), site({ takeoffId: 44, name: 'Vågå' })], unmatched: [] })

    await renderSection()

    screen.getByText('2 sites mapped')
    screen.getByText('2 site(s) on the map')
    expect(screen.queryByText(/could not be located/)).toBeNull()
  })

  // #76's core acceptance criterion: an unmatched takeoff is a counted, VISIBLE omission —
  // both the count in the summary line and the name(s) in the list below it.
  it('renders the summary line with the unmatched count and lists each unmatched name and reason, alongside the map, when some sites matched', async () => {
    mockedGetFlownSites.mockResolvedValue({
      status: 'loaded',
      sites: [site()],
      unmatched: [unmatched(), unmatched({ name: 'Some Site', reason: 'unlinked' })],
    })

    await renderSection()

    screen.getByText('1 site mapped, 2 takeoffs could not be located')
    screen.getByText('1 site(s) on the map')
    screen.getByText(/Laragne, Chabre/)
    screen.getByText(/Some Site/)
    screen.getByText(/outside the curated takeoff dataset/)
    screen.getByText(/no linkable takeoff on flightlog\.org/)
  })

  // Acceptance criterion 3: zero matched sites with nonzero unmatched must not render an empty
  // map presented as truth. This is the ONLY way sites.length can be 0 while flights exist (a
  // real join-flown-sites.ts invariant), so this is the state to prove distinctly.
  it('does not mount the map when zero sites matched, showing the omission prominently instead', async () => {
    mockedGetFlownSites.mockResolvedValue({ status: 'loaded', sites: [], unmatched: [unmatched(), unmatched({ name: 'Other Site' })] })

    await renderSection()

    screen.getByText('0 sites mapped, 2 takeoffs could not be located')
    expect(screen.queryByTestId('stub-flown-sites-map')).toBeNull()
    screen.getByText(/No sites could be mapped for this pilot/)
    screen.getByText(/Laragne, Chabre/)
    screen.getByText(/Other Site/)
  })
})
