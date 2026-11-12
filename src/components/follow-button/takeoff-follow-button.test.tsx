import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { TakeoffFollowButton } from './takeoff-follow-button'
import { getWatermark, recordSeen } from '@/lib/watermark-store/storage'
import { getSeenTripIds, recordSeenTripIds } from '@/lib/seen-trip-store/storage'

const mockFollowTakeoffAction = vi.fn()
const mockUnfollowTakeoffAction = vi.fn()

vi.mock('./actions', () => ({
  followTakeoffAction: (...args: unknown[]) => mockFollowTakeoffAction(...args),
  unfollowTakeoffAction: (...args: unknown[]) => mockUnfollowTakeoffAction(...args),
}))

const TAKEOFF = { countryId: 160, takeoffId: 133 }
const PILOT_ID = 42

beforeEach(() => {
  window.localStorage.clear()
  mockFollowTakeoffAction.mockReset()
  mockUnfollowTakeoffAction.mockReset()
})

describe('TakeoffFollowButton, signed out', () => {
  it('renders a sign-in link to /sign-in instead of a toggle', () => {
    render(<TakeoffFollowButton {...TAKEOFF} isFollowed={false} isSignedIn={false} />)

    expect(screen.getByRole('link', { name: /sign in to follow/i }).getAttribute('href')).toBe('/sign-in')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('TakeoffFollowButton, signed in', () => {
  it('renders Following when isFollowed and Follow when not', () => {
    const { unmount } = render(<TakeoffFollowButton {...TAKEOFF} isFollowed isSignedIn />)
    expect(screen.getByRole('button').textContent).toBe('Following')
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
    unmount()

    render(<TakeoffFollowButton {...TAKEOFF} isFollowed={false} isSignedIn />)
    expect(screen.getByRole('button').textContent).toBe('Follow')
  })

  it('calls followTakeoffAction with the takeoff ref and flips to Following', async () => {
    mockFollowTakeoffAction.mockResolvedValue({ status: 'success' })

    render(<TakeoffFollowButton {...TAKEOFF} isFollowed={false} isSignedIn />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Following')
    expect(mockFollowTakeoffAction).toHaveBeenCalledWith(TAKEOFF)
    expect(mockUnfollowTakeoffAction).not.toHaveBeenCalled()
  })

  it('calls unfollowTakeoffAction and flips back to Follow', async () => {
    mockUnfollowTakeoffAction.mockResolvedValue({ status: 'success' })

    render(<TakeoffFollowButton {...TAKEOFF} isFollowed isSignedIn />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Follow')
    expect(mockUnfollowTakeoffAction).toHaveBeenCalledWith(TAKEOFF)
  })

  it('shows the error and keeps the state when the action fails', async () => {
    mockFollowTakeoffAction.mockResolvedValue({ status: 'error', message: 'nope' })

    render(<TakeoffFollowButton {...TAKEOFF} isFollowed={false} isSignedIn />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('nope')
    expect(screen.getByRole('button').textContent).toBe('Follow')
  })

  it('clears no pilot watermark or seen-trip state on unfollow', async () => {
    recordSeen(PILOT_ID, '20260101000000')
    recordSeenTripIds(PILOT_ID, { fetchedTripIds: new Set([1, 2]), renderedTripIds: new Set([1, 2]) })
    mockUnfollowTakeoffAction.mockResolvedValue({ status: 'success' })

    render(<TakeoffFollowButton {...TAKEOFF} isFollowed isSignedIn />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Follow')
    expect(getWatermark(PILOT_ID)).toBe('20260101000000')
    expect(getSeenTripIds(PILOT_ID)).toEqual(new Set([1, 2]))
  })
})

describe('TakeoffFollowButton variant and onChange', () => {
  it('defaults to the prominent size', () => {
    render(<TakeoffFollowButton {...TAKEOFF} isFollowed={false} isSignedIn />)

    expect(screen.getByRole('button').className).toContain('px-3 py-1.5 text-sm')
  })

  it('renders the compact size when asked', () => {
    render(<TakeoffFollowButton {...TAKEOFF} isFollowed={false} isSignedIn variant="compact" />)

    const { className } = screen.getByRole('button')
    expect(className).toContain('px-2 py-0.5 text-xs')
    expect(className).not.toContain('px-3 py-1.5')
  })

  it('calls onChange with the new state after a successful follow and unfollow', async () => {
    mockFollowTakeoffAction.mockResolvedValue({ status: 'success' })
    mockUnfollowTakeoffAction.mockResolvedValue({ status: 'success' })
    const onChange = vi.fn()

    render(<TakeoffFollowButton {...TAKEOFF} isFollowed={false} isSignedIn onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))
    await screen.findByText('Following')
    expect(onChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByRole('button'))
    await screen.findByText('Follow')
    expect(onChange).toHaveBeenLastCalledWith(false)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('does not call onChange when the action fails', async () => {
    mockFollowTakeoffAction.mockResolvedValue({ status: 'error', message: 'nope' })
    const onChange = vi.fn()

    render(<TakeoffFollowButton {...TAKEOFF} isFollowed={false} isSignedIn onChange={onChange} />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('nope')
    expect(onChange).not.toHaveBeenCalled()
  })
})
