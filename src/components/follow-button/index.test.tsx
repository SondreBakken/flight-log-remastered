import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FollowButton } from './index'
import { getWatermark, recordSeen } from '@/lib/watermark-store/storage'
import { getSeenTripIds, recordSeenTripIds } from '@/lib/seen-trip-store/storage'

const mockFollowPilotAction = vi.fn()
const mockUnfollowPilotAction = vi.fn()

vi.mock('./actions', () => ({
  followPilotAction: (...args: unknown[]) => mockFollowPilotAction(...args),
  unfollowPilotAction: (...args: unknown[]) => mockUnfollowPilotAction(...args),
}))

const PILOT_ID = 42

// watermark-store/storage.ts and seen-trip-store/storage.ts are module-scope singletons that
// hydrate their in-memory cache from localStorage lazily, on first read, and never re-read after
// that (see storage.ts's own doc comments) — writing to window.localStorage directly, bypassing
// their own recordSeen/recordSeenTripIds, would leave that cache stale and silently invisible to
// clearWatermark/clearSeenTripIds in a later test in this same file. Seeding and reading through
// the real store functions below keeps this test proving the actual integration, not a race
// against Vitest's per-file (not per-test) module caching.
beforeEach(() => {
  window.localStorage.clear()
  mockFollowPilotAction.mockReset()
  mockUnfollowPilotAction.mockReset()
})

describe('FollowButton, signed out', () => {
  it('renders a sign-in prompt instead of a toggle, regardless of isFollowed', () => {
    render(<FollowButton isFollowed={false} isSignedIn={false} pilotId={PILOT_ID} variant="prominent" />)

    expect(screen.getByRole('link', { name: /sign in to follow/i }).getAttribute('href')).toBe('/sign-in')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('FollowButton, signed in', () => {
  it('renders as followed when isFollowed is true', () => {
    render(<FollowButton isFollowed isSignedIn pilotId={PILOT_ID} variant="prominent" />)

    const button = screen.getByRole<HTMLButtonElement>('button')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.textContent).toBe('Following')
  })

  it('renders as not followed when isFollowed is false', () => {
    render(<FollowButton isFollowed={false} isSignedIn pilotId={PILOT_ID} variant="prominent" />)

    const button = screen.getByRole<HTMLButtonElement>('button')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.textContent).toBe('Follow')
  })

  it('renders the compact variant with its own class set', () => {
    render(<FollowButton isFollowed isSignedIn pilotId={PILOT_ID} variant="compact" />)

    expect(screen.getByRole('button').className).toContain('text-xs')
  })

  it('calls followPilotAction and flips to followed on click, when starting unfollowed', async () => {
    mockFollowPilotAction.mockResolvedValue({ status: 'success' })

    render(<FollowButton isFollowed={false} isSignedIn pilotId={PILOT_ID} variant="prominent" />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Following')
    expect(mockFollowPilotAction).toHaveBeenCalledWith(PILOT_ID)
    expect(mockUnfollowPilotAction).not.toHaveBeenCalled()
  })

  it('calls unfollowPilotAction and flips to unfollowed on click, when starting followed', async () => {
    mockUnfollowPilotAction.mockResolvedValue({ status: 'success' })

    render(<FollowButton isFollowed isSignedIn pilotId={PILOT_ID} variant="prominent" />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Follow')
    expect(mockUnfollowPilotAction).toHaveBeenCalledWith(PILOT_ID)
    expect(mockFollowPilotAction).not.toHaveBeenCalled()
  })

  it('shows the inline error and leaves the button unchanged when the action fails', async () => {
    mockFollowPilotAction.mockResolvedValue({ status: 'error', message: 'Something went wrong following this pilot. Try again.' })

    render(<FollowButton isFollowed={false} isSignedIn pilotId={PILOT_ID} variant="prominent" />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Something went wrong following this pilot. Try again.')
    expect(screen.getByText('Follow')).toBeTruthy()
  })

  it('disables the button while the action is pending', async () => {
    let resolveAction!: (result: { status: 'success' }) => void
    mockFollowPilotAction.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)))

    render(<FollowButton isFollowed={false} isSignedIn pilotId={PILOT_ID} variant="prominent" />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveProperty('disabled', true)

    resolveAction({ status: 'success' })
    await screen.findByText('Following')
  })

  // Issue #5 (extended by #62 to the seen-trip store), preserved from the localStorage-store
  // era: unfollowing must drop the pilot's watermark AND seen-trip entry so a later refollow
  // shows their whole history as new again, not silently seen. Previously composed inside
  // useFollowPilot's toggle (src/lib/follow-store/use-follow-store.ts, removed by #115); this
  // component is now the only follow-toggling consumer, so it owns that composition directly.
  it('drops the watermark and seen-trip entry only AFTER a confirmed unfollow, not optimistically before it', async () => {
    recordSeen(PILOT_ID, '20260101000000')
    recordSeenTripIds(PILOT_ID, { fetchedTripIds: new Set([1, 2]), renderedTripIds: new Set([1, 2]) })
    let resolveAction!: (result: { status: 'success' }) => void
    mockUnfollowPilotAction.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)))

    render(<FollowButton isFollowed isSignedIn pilotId={PILOT_ID} variant="prominent" />)
    fireEvent.click(screen.getByRole('button'))

    expect(getWatermark(PILOT_ID)).toBe('20260101000000')
    expect(getSeenTripIds(PILOT_ID)).toEqual(new Set([1, 2]))

    resolveAction({ status: 'success' })
    await screen.findByText('Follow')

    expect(getWatermark(PILOT_ID)).toBeNull()
    expect(getSeenTripIds(PILOT_ID)).toBeNull()
  })

  it('does NOT clear the watermark when an unfollow action fails', async () => {
    recordSeen(PILOT_ID, '20260101000000')
    mockUnfollowPilotAction.mockResolvedValue({ status: 'error', message: 'Something went wrong unfollowing this pilot. Try again.' })

    render(<FollowButton isFollowed isSignedIn pilotId={PILOT_ID} variant="prominent" />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Something went wrong unfollowing this pilot. Try again.')
    expect(getWatermark(PILOT_ID)).toBe('20260101000000')
  })

  it('does NOT touch the watermark or seen-trip entry on follow — only a confirmed unfollow clears either', async () => {
    recordSeen(PILOT_ID, '20260101000000')
    recordSeenTripIds(PILOT_ID, { fetchedTripIds: new Set([1]), renderedTripIds: new Set([1]) })
    mockFollowPilotAction.mockResolvedValue({ status: 'success' })

    render(<FollowButton isFollowed={false} isSignedIn pilotId={PILOT_ID} variant="prominent" />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Following')
    expect(getWatermark(PILOT_ID)).toBe('20260101000000')
    expect(getSeenTripIds(PILOT_ID)).toEqual(new Set([1]))
  })
})
