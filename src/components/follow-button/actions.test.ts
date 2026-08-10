import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateClient = vi.fn()
const mockGetUser = vi.fn()
const mockFollowPilot = vi.fn()
const mockUnfollowPilot = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock('@/lib/follows/follow-pilot', () => ({
  followPilot: (...args: unknown[]) => mockFollowPilot(...args),
}))

vi.mock('@/lib/follows/unfollow-pilot', () => ({
  unfollowPilot: (...args: unknown[]) => mockUnfollowPilot(...args),
}))

import { followPilotAction, unfollowPilotAction } from './actions'

beforeEach(() => {
  mockCreateClient.mockResolvedValue({ auth: { getUser: mockGetUser } })
})

afterEach(() => {
  vi.spyOn(console, 'error').mockRestore()
})

describe('followPilotAction', () => {
  it('rejects with a sign-in prompt, never reaching followPilot, when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const result = await followPilotAction(4549)

    expect(result).toEqual({ status: 'error', message: 'Sign in to follow pilots.' })
    expect(mockFollowPilot).not.toHaveBeenCalled()
  })

  it('passes the authenticated userId and the given pilotId to followPilot — never a client-supplied identity', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockFollowPilot.mockResolvedValue({ kind: 'followed' })

    await followPilotAction(4549)

    expect(mockFollowPilot).toHaveBeenCalledWith(expect.anything(), { userId: 'user-abc', pilotId: 4549 })
  })

  it('reports success when followPilot succeeds', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockFollowPilot.mockResolvedValue({ kind: 'followed' })

    const result = await followPilotAction(4549)

    expect(result).toEqual({ status: 'success' })
  })

  it('surfaces a generic error when followPilot hits a db error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockFollowPilot.mockResolvedValue({ kind: 'db-error', message: 'raw db detail' })

    const result = await followPilotAction(4549)

    expect(result).toEqual({ status: 'error', message: 'Something went wrong following this pilot. Try again.' })
  })

  it('shows a generic error, without crashing, when Supabase is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateClient.mockImplementation(() => {
      throw new Error('Supabase is not configured')
    })

    const result = await followPilotAction(4549)

    expect(result).toEqual({ status: 'error', message: 'Something went wrong following this pilot. Try again.' })
    expect(mockFollowPilot).not.toHaveBeenCalled()
  })
})

describe('unfollowPilotAction', () => {
  it('rejects with a sign-in prompt, never reaching unfollowPilot, when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const result = await unfollowPilotAction(4549)

    expect(result).toEqual({ status: 'error', message: 'Sign in to follow pilots.' })
    expect(mockUnfollowPilot).not.toHaveBeenCalled()
  })

  it('passes the authenticated userId and the given pilotId to unfollowPilot — never a client-supplied identity', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockUnfollowPilot.mockResolvedValue({ kind: 'unfollowed' })

    await unfollowPilotAction(4549)

    expect(mockUnfollowPilot).toHaveBeenCalledWith(expect.anything(), { userId: 'user-abc', pilotId: 4549 })
  })

  it('reports success when unfollowPilot succeeds', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockUnfollowPilot.mockResolvedValue({ kind: 'unfollowed' })

    const result = await unfollowPilotAction(4549)

    expect(result).toEqual({ status: 'success' })
  })

  it('surfaces a generic error when unfollowPilot hits a db error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockUnfollowPilot.mockResolvedValue({ kind: 'db-error', message: 'raw db detail' })

    const result = await unfollowPilotAction(4549)

    expect(result).toEqual({ status: 'error', message: 'Something went wrong unfollowing this pilot. Try again.' })
  })

  it('shows a generic error, without crashing, when Supabase is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateClient.mockImplementation(() => {
      throw new Error('Supabase is not configured')
    })

    const result = await unfollowPilotAction(4549)

    expect(result).toEqual({ status: 'error', message: 'Something went wrong unfollowing this pilot. Try again.' })
    expect(mockUnfollowPilot).not.toHaveBeenCalled()
  })
})
