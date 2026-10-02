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
// page.tsx imports this at module scope for the FlownSites sibling boundary, which Logbook
// itself never renders — its own fetch-flown-sites.ts carries 'server-only' too, so it must be
// stubbed here regardless.
vi.mock('@/features/browse-flown-sites-map', () => ({ default: () => null }))

import { getPilotLogbook } from '@/lib/flightlog/flights'
import { getTrackedTripIds } from '@/lib/flightlog/tracks'
import { resolveFollowButtonState } from '@/lib/follows/resolve-viewer-follow-state'
import { resolveCertificateProgressState } from '@/lib/profiles/resolve-certificate-progress-state'
import { resolvePilotVerified } from '@/lib/profiles/resolve-pilot-verified'
import { Logbook } from './page'

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

const VERIFIED_LABEL = 'Has an account on Flight Log Remastered'

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
})
