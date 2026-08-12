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

import { resolveViewerFollowState } from './resolve-viewer-follow-state'

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

    expect(state).toEqual({ isSignedIn: false, followedPilotIds: [], followsUnavailable: false })
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('reports signed-out, never reaching getFollowedPilotIds, when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const state = await resolveViewerFollowState([4549])

    expect(state).toEqual({ isSignedIn: false, followedPilotIds: [], followsUnavailable: false })
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

  it('reports signed-in with the resolved followed ids as a plain array', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockGetFollowedPilotIds.mockResolvedValue(new Set([4549, 12677]))

    const state = await resolveViewerFollowState([4549, 12677])

    expect(state.isSignedIn).toBe(true)
    expect([...state.followedPilotIds].sort((a, b) => a - b)).toEqual([4549, 12677])
    expect(state.followsUnavailable).toBe(false)
  })

  it('degrades to an explicit followsUnavailable state, without crashing, when getFollowedPilotIds throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockGetFollowedPilotIds.mockRejectedValue(new Error('follows query failed'))

    const state = await resolveViewerFollowState([4549])

    expect(state).toEqual({ isSignedIn: true, followedPilotIds: [], followsUnavailable: true })
    consoleError.mockRestore()
  })
})
