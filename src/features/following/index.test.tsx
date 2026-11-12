// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { FollowsQueryError } from '@/lib/follows/follows-query-error'

const mockGetCurrentUserId = vi.fn()
const mockGetDb = vi.fn()
const mockGetFollowedPilots = vi.fn()
const mockGetFollowedTakeoffRows = vi.fn()
const mockGetPilotLogbook = vi.fn()
const mockGetTakeoffDetail = vi.fn()
const mockGetTakeoffFlights = vi.fn()
const mockGetCountries = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ cacheLife: () => {}, cacheTag: () => {} }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUserId: () => mockGetCurrentUserId() }))
vi.mock('@/lib/db/client', () => ({ getDb: () => mockGetDb() }))
vi.mock('@/lib/follows/get-followed-pilots', () => ({
  getFollowedPilots: (...args: unknown[]) => mockGetFollowedPilots(...args),
}))
vi.mock('@/lib/follows/get-followed-takeoff-rows', () => ({
  getFollowedTakeoffRows: (...args: unknown[]) => mockGetFollowedTakeoffRows(...args),
}))
vi.mock('@/lib/flightlog/flights', () => ({
  getPilotLogbook: (...args: unknown[]) => mockGetPilotLogbook(...args),
}))
vi.mock('@/lib/flightlog/takeoff-detail', () => ({
  getTakeoffDetail: (...args: unknown[]) => mockGetTakeoffDetail(...args),
}))
vi.mock('@/lib/flightlog/takeoff-flights', () => ({
  getTakeoffFlights: (...args: unknown[]) => mockGetTakeoffFlights(...args),
}))
vi.mock('@/lib/flightlog/countries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flightlog/countries')>('@/lib/flightlog/countries')
  return { ...actual, getCountries: (...args: unknown[]) => mockGetCountries(...args) }
})

import Following from './index'

const NEVER = new Promise<never>(() => {})
const NORWAY = { countryId: 160, name: 'Norway' }

// The page is built from async Server Components under Suspense, which a client-side render
// never settles, so it renders through the real server renderer instead. `settled: true` waits
// for every boundary (the whole page); `settled: false` returns the shell as soon as the stream
// goes idle, which is what a reader sees while a never-resolving hint is still pending.
async function renderPage({ settled }: { settled: boolean }): Promise<string> {
  const stream = await renderToReadableStream((await Following()) as ReactElement, { onError: () => {} })
  if (settled) await stream.allReady
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let html = ''
  for (;;) {
    const idle = Symbol('idle')
    const chunk = await Promise.race([reader.read(), new Promise<typeof idle>((resolve) => setTimeout(() => resolve(idle), 100))])
    if (chunk === idle || chunk.done) break
    html += decoder.decode(chunk.value)
  }
  return html
}

type Anchor = { href: string; text: string }

function anchorsIn(html: string): Anchor[] {
  return [...html.matchAll(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/g)].map((match) => ({
    href: match[1],
    text: match[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
  }))
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetCurrentUserId.mockResolvedValue('user-abc')
  mockGetFollowedPilots.mockResolvedValue([])
  mockGetFollowedTakeoffRows.mockResolvedValue([])
  mockGetCountries.mockResolvedValue([NORWAY])
  mockGetPilotLogbook.mockResolvedValue({ pilot: { name: 'Looked Up Pilot' }, flights: [] })
  mockGetTakeoffDetail.mockResolvedValue({ name: 'Looked Up Takeoff' })
  mockGetTakeoffFlights.mockResolvedValue([])
})

describe('Following', () => {
  it('shows a sign-in link, and reads no follows, when signed out', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    const html = await renderPage({ settled: true })

    expect(anchorsIn(html)).toEqual([{ href: '/sign-in', text: 'Sign in' }])
    expect(mockGetFollowedPilots).not.toHaveBeenCalled()
    expect(mockGetFollowedTakeoffRows).not.toHaveBeenCalled()
    expect(mockGetDb).not.toHaveBeenCalled()
  })

  it('lists pilots and takeoffs in the order the queries return them, with stored names, links and no flightlog name lookup', async () => {
    mockGetFollowedPilots.mockResolvedValue([
      { pilotId: 22, name: 'Newer Pilot', createdAt: new Date('2026-03-01T00:00:00Z') },
      { pilotId: 11, name: 'Older Pilot', createdAt: new Date('2026-01-01T00:00:00Z') },
    ])
    mockGetFollowedTakeoffRows.mockResolvedValue([
      { countryId: 160, takeoffId: 8, name: 'Newer Takeoff', createdAt: new Date('2026-03-01T00:00:00Z') },
      { countryId: 160, takeoffId: 3, name: 'Older Takeoff', createdAt: new Date('2026-01-01T00:00:00Z') },
    ])

    const html = await renderPage({ settled: true })

    expect(anchorsIn(html)).toEqual([
      { href: '/pilots/22', text: 'Newer Pilot' },
      { href: '/pilots/11', text: 'Older Pilot' },
      { href: '/countries/160/takeoffs/8', text: 'Newer Takeoff · Norway' },
      { href: '/countries/160/takeoffs/3', text: 'Older Takeoff · Norway' },
    ])
    expect(html.indexOf('Pilots')).toBeLessThan(html.indexOf('Takeoffs'))
    expect(mockGetPilotLogbook).toHaveBeenCalledTimes(2) // hints only: one per row
    expect(mockGetTakeoffDetail).not.toHaveBeenCalled()
    expect(mockGetCountries).toHaveBeenCalledTimes(1)
  })

  it('has no button, so nothing on the page can unfollow', async () => {
    mockGetFollowedPilots.mockResolvedValue([{ pilotId: 11, name: 'A', createdAt: new Date() }])
    mockGetFollowedTakeoffRows.mockResolvedValue([{ countryId: 160, takeoffId: 3, name: 'B', createdAt: new Date() }])

    expect(await renderPage({ settled: true })).not.toContain('<button')
  })

  it('shows one empty line with its link per section when the user follows nothing', async () => {
    const html = await renderPage({ settled: true })

    expect(anchorsIn(html)).toEqual([
      { href: '/pilots/search', text: 'Find a pilot' },
      { href: '/countries', text: 'Countries' },
    ])
    expect(html).toContain("You don&#x27;t follow any pilots yet.")
    expect(html).toContain("You don&#x27;t follow any takeoffs yet.")
  })

  it('shows the empty state only for the section with no rows', async () => {
    mockGetFollowedPilots.mockResolvedValue([{ pilotId: 11, name: 'Only Pilot', createdAt: new Date() }])

    const html = await renderPage({ settled: true })

    expect(anchorsIn(html)).toEqual([
      { href: '/pilots/11', text: 'Only Pilot' },
      { href: '/countries', text: 'Countries' },
    ])
    expect(html).not.toContain('any pilots yet')
    expect(html).toContain('any takeoffs yet')
  })

  it('says the section could not load, instead of the empty state, when a list query fails', async () => {
    mockGetFollowedPilots.mockRejectedValue(new FollowsQueryError('boom'))
    mockGetFollowedTakeoffRows.mockResolvedValue([{ countryId: 160, takeoffId: 3, name: 'Still There', createdAt: new Date() }])

    const html = await renderPage({ settled: true })

    expect(html).toContain('Couldn&#x27;t load your followed pilots right now.')
    expect(html).not.toContain('any pilots yet')
    expect(anchorsIn(html)).toEqual([{ href: '/countries/160/takeoffs/3', text: 'Still There · Norway' }])
  })

  describe('a row stored without a name', () => {
    const nullNamedPilot = { pilotId: 11, name: null, createdAt: new Date() }
    const nullNamedTakeoff = { countryId: 160, takeoffId: 3, name: null, createdAt: new Date() }

    beforeEach(() => {
      mockGetFollowedPilots.mockResolvedValue([nullNamedPilot])
      mockGetFollowedTakeoffRows.mockResolvedValue([nullNamedTakeoff])
    })

    it('renders the name looked up at render time', async () => {
      const html = await renderPage({ settled: true })

      expect(anchorsIn(html)).toEqual([
        { href: '/pilots/11', text: 'Looked Up Pilot' },
        { href: '/countries/160/takeoffs/3', text: 'Looked Up Takeoff · Norway' },
      ])
    })

    it('falls back to the id, keeping the href, when the lookups reject or find nothing', async () => {
      mockGetPilotLogbook.mockRejectedValue(new Error('flightlog.org down'))
      mockGetTakeoffDetail.mockResolvedValue(null)

      const html = await renderPage({ settled: true })

      expect(anchorsIn(html)).toEqual([
        { href: '/pilots/11', text: '11' },
        { href: '/countries/160/takeoffs/3', text: '3 · Norway' },
      ])
    })

    it('renders the id, not the synthetic fallback name, when the pilot page has no profile', async () => {
      mockGetPilotLogbook.mockResolvedValue({ pilot: { name: 'Pilot 11', country: null, club: null }, flights: [] })

      const html = await renderPage({ settled: true })

      expect(anchorsIn(html)[0]).toEqual({ href: '/pilots/11', text: '11' })
    })

    it('falls back to the id for a takeoff whose lookup rejects', async () => {
      mockGetTakeoffDetail.mockRejectedValue(new Error('flightlog.org down'))

      const html = await renderPage({ settled: true })

      expect(anchorsIn(html)[1]).toEqual({ href: '/countries/160/takeoffs/3', text: '3 · Norway' })
    })
  })

  it('names the country "Country <id>" when the country list fails', async () => {
    mockGetCountries.mockRejectedValue(new Error('flightlog.org down'))
    mockGetFollowedTakeoffRows.mockResolvedValue([{ countryId: 160, takeoffId: 3, name: 'Hamar', createdAt: new Date() }])

    const html = await renderPage({ settled: true })

    expect(anchorsIn(html)[1]).toEqual({ href: '/countries/160/takeoffs/3', text: 'Hamar · Country 160' })
  })

  describe('activity hints', () => {
    beforeEach(() => {
      mockGetFollowedPilots.mockResolvedValue([{ pilotId: 11, name: 'Ada', createdAt: new Date() }])
      mockGetFollowedTakeoffRows.mockResolvedValue([{ countryId: 160, takeoffId: 3, name: 'Hamar', createdAt: new Date() }])
    })

    it('shows the newest flight date per pilot and per takeoff, ignoring null dates', async () => {
      mockGetPilotLogbook.mockResolvedValue({
        pilot: { name: 'Ada' },
        flights: [{ date: '2026-02-10' }, { date: '2026-05-03' }, { date: '2026-04-01' }],
      })
      mockGetTakeoffFlights.mockResolvedValue([{ date: null }, { date: '2026-07-21' }, { date: '2026-06-30' }])

      const html = await renderPage({ settled: true })

      expect(html).toContain('Last flight')
      expect(html).toContain('3 May 2026')
      expect(html).not.toContain('10 Feb 2026')
      expect(html).toContain('21 Jul 2026')
      expect(html).not.toContain('30 Jun 2026')
    })

    it.each([
      ['a rejecting loader', () => Promise.reject(new Error('flightlog.org down'))],
      ['a null result', () => Promise.resolve(null)],
      ['an empty list', () => Promise.resolve([])],
      ['all-null dates', () => Promise.resolve([{ date: null }, { date: null }])],
    ])('renders the takeoff row without a hint on %s', async (_label, takeoffFlights) => {
      mockGetTakeoffFlights.mockImplementation(takeoffFlights)

      const html = await renderPage({ settled: true })

      expect(html).not.toContain('Last flight')
      expect(anchorsIn(html)[1]).toEqual({ href: '/countries/160/takeoffs/3', text: 'Hamar · Norway' })
    })

    it.each([
      ['a rejecting loader', () => Promise.reject(new Error('flightlog.org down'))],
      ['an empty flight list', () => Promise.resolve({ pilot: { name: 'Ada' }, flights: [] })],
    ])('renders the pilot row without a hint on %s', async (_label, logbook) => {
      mockGetPilotLogbook.mockImplementation(logbook)

      const html = await renderPage({ settled: true })

      expect(html).not.toContain('Last flight')
      expect(anchorsIn(html)[0]).toEqual({ href: '/pilots/11', text: 'Ada' })
    })

    it('renders every name and link without awaiting the hints', async () => {
      mockGetPilotLogbook.mockReturnValue(NEVER)
      mockGetTakeoffFlights.mockReturnValue(NEVER)

      const html = await renderPage({ settled: false })

      expect(anchorsIn(html)).toEqual([
        { href: '/pilots/11', text: 'Ada' },
        { href: '/countries/160/takeoffs/3', text: 'Hamar · Norway' },
      ])
      expect(html).not.toContain('Last flight')
    })
  })
})
