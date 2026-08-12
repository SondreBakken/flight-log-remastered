import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSupabaseEnv = vi.fn()
const mockCreateClient = vi.fn()
const mockGetUser = vi.fn()
const mockGetFollowedPilotIds = vi.fn()

vi.mock('@/lib/supabase/env', () => ({
  getSupabaseEnv: () => mockGetSupabaseEnv(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock('./get-followed-pilot-ids', () => ({
  getFollowedPilotIds: (...args: unknown[]) => mockGetFollowedPilotIds(...args),
}))

import {
  followedPilotIdsOf,
  resolveFollowButtonState,
  resolveViewerFollowState,
  toFollowButtonState,
} from './resolve-viewer-follow-state'
import { FollowsQueryError } from './follows-query-error'

beforeEach(() => {
  mockGetSupabaseEnv.mockReturnValue({ url: 'https://example.supabase.co', anonKey: 'anon-key' })
  mockCreateClient.mockResolvedValue({ auth: { getUser: mockGetUser } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveViewerFollowState', () => {
  it('reports signed-out, without touching Supabase at all, when Supabase is not configured', async () => {
    mockGetSupabaseEnv.mockReturnValue(null)

    const state = await resolveViewerFollowState([4549])

    expect(state).toEqual({ status: 'signed-out' })
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('reports signed-out, never reaching getFollowedPilotIds, when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const state = await resolveViewerFollowState([4549])

    expect(state).toEqual({ status: 'signed-out' })
    expect(mockGetFollowedPilotIds).not.toHaveBeenCalled()
  })

  it('passes the authenticated userId and the given candidate ids to getFollowedPilotIds — never a client-supplied identity', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockGetFollowedPilotIds.mockResolvedValue(new Set([4549]))

    await resolveViewerFollowState([4549, 12677])

    expect(mockGetFollowedPilotIds).toHaveBeenCalledWith(expect.anything(), 'user-abc', [4549, 12677])
  })

  it('passes candidatePilotIds through as undefined when omitted, for an unscoped "every followed pilot" read', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockGetFollowedPilotIds.mockResolvedValue(new Set())

    await resolveViewerFollowState()

    expect(mockGetFollowedPilotIds).toHaveBeenCalledWith(expect.anything(), 'user-abc', undefined)
  })

  it('reports a resolved status with the resolved followed ids as a plain array', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockGetFollowedPilotIds.mockResolvedValue(new Set([4549, 12677]))

    const state = await resolveViewerFollowState([4549, 12677])

    expect(state.status).toBe('resolved')
    if (state.status !== 'resolved') throw new Error('unreachable')
    expect([...state.followedPilotIds].sort((a, b) => a - b)).toEqual([4549, 12677])
  })

  it('degrades to an explicit follows-unavailable status, without crashing, when getFollowedPilotIds throws a FollowsQueryError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockGetFollowedPilotIds.mockRejectedValue(new FollowsQueryError('follows query failed'))

    const state = await resolveViewerFollowState([4549])

    expect(state).toEqual({ status: 'follows-unavailable' })
    consoleError.mockRestore()
  })

  it('rethrows, rather than degrading, when getFollowedPilotIds throws something other than a FollowsQueryError', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockGetFollowedPilotIds.mockRejectedValue(new TypeError('data was null'))

    await expect(resolveViewerFollowState([4549])).rejects.toThrow(TypeError)
  })
})

describe('followedPilotIdsOf', () => {
  it('returns a genuine empty array for signed-out, not null — that status IS a resolved follow list', () => {
    expect(followedPilotIdsOf({ status: 'signed-out' })).toEqual([])
  })

  it('returns the resolved follow list as-is', () => {
    expect(followedPilotIdsOf({ status: 'resolved', followedPilotIds: [4549] })).toEqual([4549])
  })

  it('returns null for follows-unavailable — the one status with no real list to hand back', () => {
    expect(followedPilotIdsOf({ status: 'follows-unavailable' })).toBeNull()
  })
})

describe('toFollowButtonState', () => {
  it('degrades a signed-out state to isSignedIn: false with no follows', () => {
    expect(toFollowButtonState({ status: 'signed-out' })).toEqual({ isSignedIn: false, followedPilotIds: [] })
  })

  it('passes a resolved state through as isSignedIn: true with its followed ids', () => {
    expect(toFollowButtonState({ status: 'resolved', followedPilotIds: [4549] })).toEqual({
      isSignedIn: true,
      followedPilotIds: [4549],
    })
  })

  it('degrades a follows-unavailable state to isSignedIn: true with no follows, same as "follows nobody"', () => {
    expect(toFollowButtonState({ status: 'follows-unavailable' })).toEqual({ isSignedIn: true, followedPilotIds: [] })
  })
})

describe('resolveFollowButtonState', () => {
  it('composes resolveViewerFollowState and toFollowButtonState into the one call site adornment pages use', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockGetFollowedPilotIds.mockResolvedValue(new Set([4549]))

    const result = await resolveFollowButtonState([4549])

    expect(result).toEqual({ isSignedIn: true, followedPilotIds: [4549] })
  })

  it('degrades a follows query failure to the same isSignedIn: true, no-follows shape toFollowButtonState gives, without crashing the caller', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockGetFollowedPilotIds.mockRejectedValue(new FollowsQueryError('follows query failed'))

    const result = await resolveFollowButtonState([4549])

    expect(result).toEqual({ isSignedIn: true, followedPilotIds: [] })
    consoleError.mockRestore()
  })
})
