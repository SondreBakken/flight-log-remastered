import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetCurrentUserId = vi.fn()
const mockGetFollowedPilotIds = vi.fn()
const mockGetFollowedTakeoffs = vi.fn()

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({}),
}))

vi.mock('./get-followed-pilot-ids', () => ({
  getFollowedPilotIds: (...args: unknown[]) => mockGetFollowedPilotIds(...args),
}))

vi.mock('./get-followed-takeoffs', () => ({
  getFollowedTakeoffs: (...args: unknown[]) => mockGetFollowedTakeoffs(...args),
}))

import {
  followedPilotIdsOf,
  followedTakeoffsOf,
  resolveFollowButtonState,
  resolveViewerFollowState,
  toFollowButtonState,
  toTakeoffFollowButtonState,
} from './resolve-viewer-follow-state'
import { FollowsQueryError } from './follows-query-error'

beforeEach(() => {
  mockGetFollowedTakeoffs.mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveViewerFollowState', () => {
  it('reports signed-out, never reaching getFollowedPilotIds, when there is no session', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    const state = await resolveViewerFollowState([900024])

    expect(state).toEqual({ status: 'signed-out' })
    expect(mockGetFollowedPilotIds).not.toHaveBeenCalled()
  })

  it('passes the authenticated userId and the given candidate ids to getFollowedPilotIds — never a client-supplied identity', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockGetFollowedPilotIds.mockResolvedValue(new Set([900024]))

    await resolveViewerFollowState([900024, 12677])

    expect(mockGetFollowedPilotIds).toHaveBeenCalledWith(expect.anything(), 'user-abc', [900024, 12677])
  })

  it('passes candidatePilotIds through as undefined when omitted, for an unscoped "every followed pilot" read', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockGetFollowedPilotIds.mockResolvedValue(new Set())

    await resolveViewerFollowState()

    expect(mockGetFollowedPilotIds).toHaveBeenCalledWith(expect.anything(), 'user-abc', undefined)
  })

  it('reports a resolved status with the resolved followed ids as a plain array', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockGetFollowedPilotIds.mockResolvedValue(new Set([900024, 12677]))

    const state = await resolveViewerFollowState([900024, 12677])

    expect(state.status).toBe('resolved')
    if (state.status !== 'resolved') throw new Error('unreachable')
    expect([...state.followedPilotIds].sort((a, b) => a - b)).toEqual([12677, 900024])
  })

  it('resolves the followed takeoffs alongside the pilots, for the authenticated user only', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockGetFollowedPilotIds.mockResolvedValue(new Set([900024]))
    mockGetFollowedTakeoffs.mockResolvedValue([{ countryId: 160, takeoffId: 133 }])

    const state = await resolveViewerFollowState([900024])

    expect(state).toEqual({
      status: 'resolved',
      followedPilotIds: [900024],
      followedTakeoffs: [{ countryId: 160, takeoffId: 133 }],
    })
    expect(mockGetFollowedTakeoffs).toHaveBeenCalledWith(expect.anything(), 'user-abc')
  })

  it('degrades to follows-unavailable when only the takeoff query throws a FollowsQueryError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockGetFollowedPilotIds.mockResolvedValue(new Set([900024]))
    mockGetFollowedTakeoffs.mockRejectedValue(new FollowsQueryError('takeoff follows query failed'))

    expect(await resolveViewerFollowState([900024])).toEqual({ status: 'follows-unavailable' })
    consoleError.mockRestore()
  })

  it('degrades to an explicit follows-unavailable status, without crashing, when getFollowedPilotIds throws a FollowsQueryError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockGetFollowedPilotIds.mockRejectedValue(new FollowsQueryError('follows query failed'))

    const state = await resolveViewerFollowState([900024])

    expect(state).toEqual({ status: 'follows-unavailable' })
    consoleError.mockRestore()
  })

  it('rethrows, rather than degrading, when getFollowedPilotIds throws something other than a FollowsQueryError', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockGetFollowedPilotIds.mockRejectedValue(new TypeError('data was null'))

    await expect(resolveViewerFollowState([900024])).rejects.toThrow(TypeError)
  })
})

describe('followedPilotIdsOf', () => {
  it('returns a genuine empty array for signed-out, not null — that status IS a resolved follow list', () => {
    expect(followedPilotIdsOf({ status: 'signed-out' })).toEqual([])
  })

  it('returns the resolved follow list as-is', () => {
    expect(followedPilotIdsOf({ status: 'resolved', followedPilotIds: [900024], followedTakeoffs: [] })).toEqual([900024])
  })

  it('returns null for follows-unavailable — the one status with no real list to hand back', () => {
    expect(followedPilotIdsOf({ status: 'follows-unavailable' })).toBeNull()
  })
})

describe('followedTakeoffsOf', () => {
  const resolved = { status: 'resolved', followedPilotIds: [], followedTakeoffs: [{ countryId: 160, takeoffId: 133 }] } as const

  it('returns an empty list for signed-out, the resolved list as-is, and null for follows-unavailable', () => {
    expect(followedTakeoffsOf({ status: 'signed-out' })).toEqual([])
    expect(followedTakeoffsOf(resolved)).toEqual([{ countryId: 160, takeoffId: 133 }])
    expect(followedTakeoffsOf({ status: 'follows-unavailable' })).toBeNull()
  })
})

describe('toTakeoffFollowButtonState', () => {
  const resolved = { status: 'resolved', followedPilotIds: [], followedTakeoffs: [{ countryId: 160, takeoffId: 133 }] } as const

  it('marks the takeoff followed only when both countryId and takeoffId match', () => {
    expect(toTakeoffFollowButtonState(resolved, { countryId: 160, takeoffId: 133 })).toEqual({ isSignedIn: true, isFollowed: true })
    expect(toTakeoffFollowButtonState(resolved, { countryId: 203, takeoffId: 133 })).toEqual({ isSignedIn: true, isFollowed: false })
    expect(toTakeoffFollowButtonState(resolved, { countryId: 160, takeoffId: 134 })).toEqual({ isSignedIn: true, isFollowed: false })
  })

  it('degrades signed-out and follows-unavailable to not-followed', () => {
    const takeoff = { countryId: 160, takeoffId: 133 }
    expect(toTakeoffFollowButtonState({ status: 'signed-out' }, takeoff)).toEqual({ isSignedIn: false, isFollowed: false })
    expect(toTakeoffFollowButtonState({ status: 'follows-unavailable' }, takeoff)).toEqual({ isSignedIn: true, isFollowed: false })
  })
})

describe('toFollowButtonState', () => {
  it('degrades a signed-out state to isSignedIn: false with no follows', () => {
    expect(toFollowButtonState({ status: 'signed-out' })).toEqual({ isSignedIn: false, followedPilotIds: [] })
  })

  it('passes a resolved state through as isSignedIn: true with its followed ids', () => {
    expect(toFollowButtonState({ status: 'resolved', followedPilotIds: [900024], followedTakeoffs: [] })).toEqual({
      isSignedIn: true,
      followedPilotIds: [900024],
    })
  })

  it('degrades a follows-unavailable state to isSignedIn: true with no follows, same as "follows nobody"', () => {
    expect(toFollowButtonState({ status: 'follows-unavailable' })).toEqual({ isSignedIn: true, followedPilotIds: [] })
  })
})

describe('resolveFollowButtonState', () => {
  it('composes resolveViewerFollowState and toFollowButtonState into the one call site adornment pages use', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockGetFollowedPilotIds.mockResolvedValue(new Set([900024]))

    const result = await resolveFollowButtonState([900024])

    expect(result).toEqual({ isSignedIn: true, followedPilotIds: [900024] })
  })

  it('degrades a follows query failure to the same isSignedIn: true, no-follows shape toFollowButtonState gives, without crashing the caller', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockGetFollowedPilotIds.mockRejectedValue(new FollowsQueryError('follows query failed'))

    const result = await resolveFollowButtonState([900024])

    expect(result).toEqual({ isSignedIn: true, followedPilotIds: [] })
    consoleError.mockRestore()
  })
})
