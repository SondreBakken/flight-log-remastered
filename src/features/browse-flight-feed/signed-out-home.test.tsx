import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/flightlog/recent-public-flights', () => ({ getRecentTrackedFlights: vi.fn() }))

import { getRecentTrackedFlights } from '@/lib/flightlog/recent-public-flights'
import { SignedOutHome } from './signed-out-home'
import type { TakeoffFlight } from '@/lib/flightlog/types'

const mockedRecent = vi.mocked(getRecentTrackedFlights)
const DEFAULT_PILOT_ID = 4549

const FLIGHT: TakeoffFlight = {
  tripId: 1017579,
  userId: 11405,
  pilotName: 'Thomas Lone',
  club: null,
  glider: null,
  duration: '00:07',
  distanceKm: 2.9,
  note: null,
  date: '2026-11-09',
  timeOfDay: null,
}

async function renderHome() {
  render(await SignedOutHome({ defaultPilotId: DEFAULT_PILOT_ID }))
}

function expectDiscoveryLinks() {
  expect(screen.getByRole('link', { name: /search for a pilot/i }).getAttribute('href')).toBe('/pilots/search')
  expect(screen.getByRole('link', { name: /browse a pilot/i }).getAttribute('href')).toBe(`/pilots/${DEFAULT_PILOT_ID}`)
  expect(screen.getByRole('link', { name: /browse clubs by country/i }).getAttribute('href')).toBe('/countries')
}

describe('SignedOutHome', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders the heading, intro, a row linking to the flight and the pilot, and the discovery links', async () => {
    mockedRecent.mockResolvedValue([FLIGHT])

    await renderHome()

    expect(screen.getByRole('heading', { level: 1, name: 'Recent flights' })).toBeTruthy()
    expect(screen.getByText(/recent paragliding flights in norway/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View track' }).getAttribute('href')).toBe('/flights/1017579')
    expect(screen.getByRole('link', { name: 'Thomas Lone' }).getAttribute('href')).toBe('/pilots/11405')
    expect(screen.queryByText(/not following any pilots/i)).toBeNull()
    expect(screen.queryByText(/unavailable/i)).toBeNull()
    expectDiscoveryLinks()
  })

  it('renders an unavailable line, no table and no error text when there are no tracked flights', async () => {
    mockedRecent.mockResolvedValue([])

    await renderHome()

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText(/recent flights are unavailable/i)).toBeTruthy()
    expectDiscoveryLinks()
  })

  it('does not reject when loading the flights throws, and shows the same fallback', async () => {
    mockedRecent.mockRejectedValue(new Error('flightlog.org down'))

    await renderHome()

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(/flightlog\.org down/)).toBeNull()
    expect(screen.getByText(/recent flights are unavailable/i)).toBeTruthy()
    expectDiscoveryLinks()
  })
})
