import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Flight, Pilot } from '@/lib/flightlog/types'

// Mocking the whole module (hoisted above these imports by Vitest) means the real 'server-only'
// fetchers never run, same reasoning as the sibling flights/[tripId]/page.test.tsx.
vi.mock('@/lib/flightlog/flights', () => ({ getPilotLogbook: vi.fn() }))
vi.mock('@/lib/flightlog/tracks', () => ({ getTrackedTripIds: vi.fn() }))
vi.mock('@/lib/follows/resolve-viewer-follow-state', () => ({ resolveFollowButtonState: vi.fn() }))
vi.mock('@/lib/profiles/resolve-certificate-progress-state', () => ({ resolveCertificateProgressState: vi.fn() }))
vi.mock('@/lib/profiles/resolve-pilot-verified', () => ({ resolvePilotVerified: vi.fn() }))
// FlightRow (a client component) calls useRouter, which throws outside a mounted app router.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: vi.fn() }),
}))
// Logbook passes this to PilotLogbook as the map slot; its own fetch-flown-sites.ts carries
// 'server-only', so it must be stubbed.
vi.mock('@/features/browse-flown-sites-map', () => ({ default: () => null }))

import { getPilotLogbook } from '@/lib/flightlog/flights'
import { getTrackedTripIds } from '@/lib/flightlog/tracks'
import { resolveFollowButtonState } from '@/lib/follows/resolve-viewer-follow-state'
import { resolveCertificateProgressState } from '@/lib/profiles/resolve-certificate-progress-state'
import { resolvePilotVerified } from '@/lib/profiles/resolve-pilot-verified'
import { Logbook, generateMetadata } from './page'

const mockedGetPilotLogbook = vi.mocked(getPilotLogbook)
const mockedResolvePilotVerified = vi.mocked(resolvePilotVerified)
const mockedGetTrackedTripIds = vi.mocked(getTrackedTripIds)
const mockedResolveFollowButtonState = vi.mocked(resolveFollowButtonState)
const mockedResolveCertificateProgressState = vi.mocked(resolveCertificateProgressState)

const REAL_PILOT: Pilot = {
  userId: 12677,
  name: 'Sondre Bakken',
  country: 'Norway',
  club: 'Voss Hang- Og Paragliderklubb',
}

// The exact shape parsePilot degrades both "genuinely missing profile" and "real pilot, empty
// profile" to — see is-fallback-pilot.ts's own doc comment.
const FALLBACK_PILOT: Pilot = { userId: 999999999, name: 'Pilot 999999999', country: null, club: null }

const NO_FLIGHTS: Flight[] = []

function stubDependencies(pilot: Pilot) {
  mockedGetPilotLogbook.mockResolvedValue({ pilot, flights: NO_FLIGHTS })
  mockedGetTrackedTripIds.mockResolvedValue(new Set())
  mockedResolveFollowButtonState.mockResolvedValue({ isSignedIn: false, followedPilotIds: [] })
  mockedResolveCertificateProgressState.mockResolvedValue({ isOwner: false, level: null, levelSetAt: null, checklist: {} })
  mockedResolvePilotVerified.mockResolvedValue(false)
}

const VERIFIED_LABEL = 'Has an account on Flightlog Social'

describe('Logbook', () => {
  // #239: a syntactically valid but nonexistent pilot id (e.g. a large unallocated one) flowed
  // straight through to a normal, empty-looking profile instead of 404ing, because parsePilot
  // itself cannot tell "no such pilot" from "a real pilot with zero flights" apart.
  it('renders notFound when getPilotLogbook returns the fallback-pilot shape', async () => {
    stubDependencies(FALLBACK_PILOT)

    await expect(Logbook({ params: Promise.resolve({ userId: '999999999' }) })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    })
  })

  it('renders the logbook normally for a real pilot with an empty logbook, not notFound', async () => {
    stubDependencies({ ...REAL_PILOT, name: 'Pilot 12677' })

    const element = await Logbook({ params: Promise.resolve({ userId: '12677' }) })
    render(element)

    screen.getByText('Pilot 12677')
  })

  it('renders the logbook normally for a real pilot with a real name, not notFound', async () => {
    stubDependencies(REAL_PILOT)

    const element = await Logbook({ params: Promise.resolve({ userId: '12677' }) })
    render(element)

    screen.getByText('Sondre Bakken')
  })

  it('shows the verified-account icon for a verified pilot', async () => {
    stubDependencies(REAL_PILOT)
    mockedResolvePilotVerified.mockResolvedValue(true)

    const element = await Logbook({ params: Promise.resolve({ userId: '12677' }) })
    render(element)

    expect(mockedResolvePilotVerified).toHaveBeenCalledWith(12677)
    screen.getByRole('img', { name: VERIFIED_LABEL })
  })

  it('shows no verified-account icon for a pilot without a verified account', async () => {
    stubDependencies(REAL_PILOT)

    const element = await Logbook({ params: Promise.resolve({ userId: '12677' }) })
    render(element)

    expect(screen.queryByRole('img', { name: VERIFIED_LABEL })).toBeNull()
  })

  it('renders the summary above the flown-sites map, and the map above the first logbook table', async () => {
    stubDependencies(REAL_PILOT)
    mockedGetPilotLogbook.mockResolvedValue({
      pilot: REAL_PILOT,
      flights: [
        {
          tripId: 1,
          userId: 12677,
          date: '2026-07-23',
          country: 'Norway',
          takeoff: 'Voss, Hjelle/Gjelle',
          takeoffRef: null,
          glider: 'skywalk Mescal 6',
          duration: '00:10',
          flightCount: 1,
          distanceKm: null,
          openDistanceKm: null,
          note: null,
        },
      ],
    })

    const element = await Logbook({ params: Promise.resolve({ userId: '12677' }) })
    const { container } = render(element)

    const summary = screen.getByRole('region', { name: 'Summary' })
    // FlownSites is an async server component that never resolves in a client render, so the
    // map slot shows its Suspense fallback here; its position is what this test pins.
    const map = screen.getByTestId('flown-sites-skeleton')
    const table = container.querySelector('details') as Element
    expect(summary.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(map.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('generateMetadata', () => {
  it('titles the page with the pilot name, loading the logbook by the parsed numeric id', async () => {
    mockedGetPilotLogbook.mockResolvedValue({ pilot: REAL_PILOT, flights: NO_FLIGHTS })

    expect(await generateMetadata({ params: Promise.resolve({ userId: '12677' }) })).toEqual({ title: 'Sondre Bakken' })
    expect(mockedGetPilotLogbook).toHaveBeenCalledWith(12677)
  })

  it('renders notFound for the fallback-pilot shape rather than titling `Pilot <id>`', async () => {
    mockedGetPilotLogbook.mockResolvedValue({ pilot: FALLBACK_PILOT, flights: NO_FLIGHTS })

    await expect(generateMetadata({ params: Promise.resolve({ userId: '999999999' }) })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    })
  })

  it.each(['abc', '0', '-1', '1.5'])('renders notFound for the malformed id %j without loading the logbook', async (userId) => {
    await expect(generateMetadata({ params: Promise.resolve({ userId }) })).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
    })
    expect(mockedGetPilotLogbook).not.toHaveBeenCalled()
  })
})
