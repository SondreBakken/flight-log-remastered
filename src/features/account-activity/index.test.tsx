import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'

const mockGetCurrentUserId = vi.fn()
const mockGetProfile = vi.fn()
const mockGetVerifiedPilotIds = vi.fn()
const mockGetFollowersForPilot = vi.fn()
const mockGetPilotLogbook = vi.fn()
const mockGetCommentsForTripIds = vi.fn()

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({}),
}))

vi.mock('@/lib/profiles/get-profile', () => ({
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
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
  mockGetCurrentUserId.mockResolvedValue('user-abc')
  mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 12677 })
  mockGetVerifiedPilotIds.mockResolvedValue(new Set())
  mockGetFollowersForPilot.mockResolvedValue([])
  mockGetPilotLogbook.mockResolvedValue({ flights: [] })
  mockGetCommentsForTripIds.mockResolvedValue([])
})

async function renderActivity() {
  render(await AccountActivity())
}

describe('AccountActivity', () => {
  it("asks only about the session user's own verification of the linked pilot id", async () => {
    await renderActivity()

    expect(mockGetVerifiedPilotIds).toHaveBeenCalledWith(expect.anything(), 'user-abc', [12677])
  })

  it('shows the unverified-link note when the linked pilot id has no verified row', async () => {
    mockGetVerifiedPilotIds.mockResolvedValue(new Set())

    await renderActivity()

    expect(screen.getByText(UNVERIFIED_NOTE_TEXT)).toBeTruthy()
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

  // Fail-safe default (see isOwnPilotIdVerified's own doc comment in index.tsx): a broken
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
    mockGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: null })

    await renderActivity()

    expect(screen.getByText(/Link your flightlog.org pilot id/)).toBeTruthy()
    expect(mockGetVerifiedPilotIds).not.toHaveBeenCalled()
  })

  it("reads the signed-in user's own profile, and says so when that lookup fails rather than asking to link a pilot id", async () => {
    mockGetProfile.mockRejectedValue(new ProfilesQueryError('profiles query failed'))

    await renderActivity()

    expect(mockGetProfile).toHaveBeenCalledWith(expect.anything(), 'user-abc')
    expect(screen.getByText(/Couldn't check your linked flightlog.org pilot id/)).toBeTruthy()
  })

  it('asks a signed-out visitor to sign in, without reading any profile', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    await renderActivity()

    expect(screen.getByText('Sign in')).toBeTruthy()
    expect(mockGetProfile).not.toHaveBeenCalled()
  })

  it('shows an icon on the unverified-link note', async () => {
    mockGetVerifiedPilotIds.mockResolvedValue(new Set())

    const { container } = render(await AccountActivity())

    expect(container.querySelector('svg')).toBeTruthy()
  })
})
