import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/flightlog/recent-public-flights', () => ({ getRecentTrackedFlights: vi.fn() }))

import { getRecentTrackedFlights } from '@/lib/flightlog/recent-public-flights'
import { SignedOutHome } from './signed-out-home'
import type { TakeoffFlight } from '@/lib/flightlog/types'

const mockedRecent = vi.mocked(getRecentTrackedFlights)
const DEFAULT_PILOT_ID = 900024

const FLIGHT: TakeoffFlight = {
  tripId: 9000002,
  userId: 900002,
  pilotName: 'Pilot Two',
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
    expect(screen.getByText(/recent flights in norway/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View track' }).getAttribute('href')).toBe('/flights/9000002')
    expect(screen.getByRole('link', { name: 'Pilot Two' }).getAttribute('href')).toBe('/pilots/900002')
    expect(screen.queryByText(/not following any pilots/i)).toBeNull()
    expect(screen.queryByText(/unavailable/i)).toBeNull()
    expectDiscoveryLinks()
  })

  it('styles the table with the form layer: rule borders and form-label headers', async () => {
    mockedRecent.mockResolvedValue([FLIGHT])

    const { container } = render(await SignedOutHome({ defaultPilotId: DEFAULT_PILOT_ID }))

    expect(container.querySelector('thead tr')?.className).toContain('border-rule')
    const headers = [...container.querySelectorAll('thead th')]
    expect(headers.length).toBeGreaterThan(0)
    for (const th of headers) expect(th.className).toContain('form-label')
    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(1)
    for (const tr of rows) expect(tr.className).toContain('border-rule')
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
