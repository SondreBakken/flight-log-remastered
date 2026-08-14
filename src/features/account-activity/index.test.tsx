import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'

const mockGetSupabaseEnv = vi.fn()
const mockCreateClient = vi.fn()
const mockGetUser = vi.fn()
const mockGetFlightlogPilotIds = vi.fn()
const mockGetVerifiedPilotIds = vi.fn()
const mockGetFollowersForPilot = vi.fn()
const mockGetPilotLogbook = vi.fn()
const mockGetCommentsForTripIds = vi.fn()

vi.mock('@/lib/supabase/env', () => ({
  getSupabaseEnv: () => mockGetSupabaseEnv(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock('@/lib/profiles/get-flightlog-pilot-ids', () => ({
  getFlightlogPilotIds: (...args: unknown[]) => mockGetFlightlogPilotIds(...args),
}))

vi.mock('@/lib/profiles/get-verified-pilot-ids', () => ({
  getVerifiedPilotIds: (...args: unknown[]) => mockGetVerifiedPilotIds(...args),
}))

vi.mock('@/lib/follows/get-followers-for-pilot', () => ({
  getFollowersForPilot: (...args: unknown[]) => mockGetFollowersForPilot(...args),
}))

vi.mock('@/lib/flightlog/flights', () => ({
  getPilotLogbook: (...args: unknown[]) => mockGetPilotLogbook(...args),
}))

vi.mock('@/lib/comments/get-comments-for-trip-ids', () => ({
  getCommentsForTripIds: (...args: unknown[]) => mockGetCommentsForTripIds(...args),
}))

import AccountActivity from './index'

const UNVERIFIED_NOTE_TEXT = /That link is currently unverified and self-declared/

// Followers/CommentsOnMyFlights are themselves async Server Components rendered as Suspense
// children — a plain client-side render (this test's own react-dom, not Next's RSC renderer)
// never resolves those, they stay stuck on their own skeleton fallback forever (confirmed empirically:
// a bare async function component under <Suspense> never settles under React's client
// reconciler). That's fine here: the note under test sits outside both Suspense boundaries and
// renders synchronously, so these two sections' own mocks only need to resolve without throwing —
// their rendered content is never asserted on by this suite.
beforeEach(() => {
  mockGetSupabaseEnv.mockReturnValue({ url: 'https://project.supabase.co', anonKey: 'anon-key' })
  mockCreateClient.mockResolvedValue({ auth: { getUser: mockGetUser } })
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
  mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-abc', 12677]]))
  mockGetVerifiedPilotIds.mockResolvedValue(new Set())
  mockGetFollowersForPilot.mockResolvedValue([])
  mockGetPilotLogbook.mockResolvedValue({ flights: [] })
  mockGetCommentsForTripIds.mockResolvedValue([])
})

async function renderActivity() {
  render(await AccountActivity())
}

describe('AccountActivity', () => {
  it('shows the unverified-link note when the linked pilot id has no verified row', async () => {
    mockGetVerifiedPilotIds.mockResolvedValue(new Set())

    await renderActivity()

    expect(screen.getByText(UNVERIFIED_NOTE_TEXT)).toBeTruthy()
    expect(mockGetVerifiedPilotIds).toHaveBeenCalledWith(expect.anything(), [12677])
  })

  // Distinct from the "no row at all" case above only in what the mock represents (a pending, not
  // yet confirmed row) — getVerifiedPilotIds itself already collapses "no row" and "row present
  // but not verified" into the same "absent from the Set" shape (see its own doc comment), so
  // this and the test above exercise the same branch in AccountActivity but pin that neither
  // depends on which underlying DB state produced the empty Set.
  it('keeps showing the unverified-link note when the pilot id has a pending, unconfirmed row', async () => {
    mockGetVerifiedPilotIds.mockResolvedValue(new Set([4549])) // some other pilot id, not this one

    await renderActivity()

    expect(screen.getByText(UNVERIFIED_NOTE_TEXT)).toBeTruthy()
  })

  it('hides the unverified-link note once the linked pilot id has a verified row', async () => {
    mockGetVerifiedPilotIds.mockResolvedValue(new Set([12677]))

    await renderActivity()

    expect(screen.queryByText(UNVERIFIED_NOTE_TEXT)).toBeNull()
  })

  // Fail-safe default (see isPilotIdVerified's own doc comment in index.tsx): a broken
  // verification lookup must never silently suppress the disclaimer, and must not take down the
  // whole page the way a failed pilot-id lookup does.
  it('keeps showing the unverified-link note, without crashing the page, when the verification lookup itself fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetVerifiedPilotIds.mockRejectedValue(new ProfilesQueryError('profile_verifications query failed'))

    await renderActivity()

    expect(screen.getByText(UNVERIFIED_NOTE_TEXT)).toBeTruthy()
    consoleError.mockRestore()
  })

  it('does not query verification status for a signed-in user with no pilot id linked', async () => {
    mockGetFlightlogPilotIds.mockResolvedValue(new Map())

    await renderActivity()

    expect(mockGetVerifiedPilotIds).not.toHaveBeenCalled()
  })
})
