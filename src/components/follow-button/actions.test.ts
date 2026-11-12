import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetCurrentUserId = vi.fn()
const mockFollowPilot = vi.fn()
const mockUnfollowPilot = vi.fn()
const mockFollowTakeoff = vi.fn()
const mockUnfollowTakeoff = vi.fn()
const mockGetPilotLogbook = vi.fn()
const mockGetTakeoffDetail = vi.fn()

vi.mock('@/lib/flightlog/flights', () => ({
  getPilotLogbook: (...args: unknown[]) => mockGetPilotLogbook(...args),
}))

vi.mock('@/lib/flightlog/takeoff-detail', () => ({
  getTakeoffDetail: (...args: unknown[]) => mockGetTakeoffDetail(...args),
}))

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: () => ({}),
}))

vi.mock('@/lib/follows/follow-pilot', () => ({
  followPilot: (...args: unknown[]) => mockFollowPilot(...args),
}))

vi.mock('@/lib/follows/unfollow-pilot', () => ({
  unfollowPilot: (...args: unknown[]) => mockUnfollowPilot(...args),
}))

vi.mock('@/lib/follows/follow-takeoff', () => ({
  followTakeoff: (...args: unknown[]) => mockFollowTakeoff(...args),
}))

vi.mock('@/lib/follows/unfollow-takeoff', () => ({
  unfollowTakeoff: (...args: unknown[]) => mockUnfollowTakeoff(...args),
}))

import { NAME_LOOKUP_TIMEOUT_MS } from './lookup-follow-name'
import { followPilotAction, followTakeoffAction, unfollowPilotAction, unfollowTakeoffAction } from './actions'

beforeEach(() => {
  mockGetPilotLogbook.mockResolvedValue({ pilot: { name: 'Ada Pilot' }, flights: [] })
  mockGetTakeoffDetail.mockResolvedValue({ name: 'Hamar' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  mockGetPilotLogbook.mockReset()
  mockGetTakeoffDetail.mockReset()
})

describe('followPilotAction', () => {
  it('rejects with a sign-in prompt, never reaching followPilot, when there is no session', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    const result = await followPilotAction(900024)

    expect(result).toEqual({ status: 'error', message: 'Sign in to follow pilots.' })
    expect(mockFollowPilot).not.toHaveBeenCalled()
  })

  it('passes the authenticated userId and the given pilotId to followPilot — never a client-supplied identity', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockFollowPilot.mockResolvedValue({ kind: 'followed' })

    await followPilotAction(900024)

    expect(mockFollowPilot).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-abc',
      pilotId: 900024,
      name: 'Ada Pilot',
    })
  })

  it('reports success when followPilot succeeds', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockFollowPilot.mockResolvedValue({ kind: 'followed' })

    const result = await followPilotAction(900024)

    expect(result).toEqual({ status: 'success' })
  })

  it('surfaces a generic error when followPilot hits a db error', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockFollowPilot.mockResolvedValue({ kind: 'db-error', message: 'raw db detail' })

    const result = await followPilotAction(900024)

    expect(result).toEqual({ status: 'error', message: 'Something went wrong following this pilot. Try again.' })
  })

  it('takes the stored name from the flightlog lookup for the id, never from the caller', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockFollowPilot.mockResolvedValue({ kind: 'followed' })

    await followPilotAction(900024)

    expect(mockGetPilotLogbook).toHaveBeenCalledWith(900024)
    expect(followPilotAction.length).toBe(1)
  })

  describe('when the name lookup fails', () => {
    beforeEach(() => {
      mockGetCurrentUserId.mockResolvedValue('user-abc')
      mockFollowPilot.mockResolvedValue({ kind: 'followed' })
    })

    it('still follows with a null name when the lookup throws', async () => {
      mockGetPilotLogbook.mockRejectedValue(new Error('flightlog.org down'))

      expect(await followPilotAction(900024)).toEqual({ status: 'success' })
      expect(mockFollowPilot).toHaveBeenCalledWith(expect.anything(), { userId: 'user-abc', pilotId: 900024, name: null })
    })

    it('still follows with a null name when the lookup outlasts the timeout', async () => {
      vi.useFakeTimers()
      mockGetPilotLogbook.mockReturnValue(new Promise(() => {}))

      const pending = followPilotAction(900024)
      await vi.advanceTimersByTimeAsync(NAME_LOOKUP_TIMEOUT_MS)

      expect(await pending).toEqual({ status: 'success' })
      expect(mockFollowPilot).toHaveBeenCalledWith(expect.anything(), { userId: 'user-abc', pilotId: 900024, name: null })
    })

    it('keeps the db error result rather than masking it', async () => {
      mockGetPilotLogbook.mockRejectedValue(new Error('flightlog.org down'))
      mockFollowPilot.mockResolvedValue({ kind: 'db-error', message: 'raw db detail' })

      expect(await followPilotAction(900024)).toEqual({
        status: 'error',
        message: 'Something went wrong following this pilot. Try again.',
      })
    })
  })
})

describe('unfollowPilotAction', () => {
  it('rejects with a sign-in prompt, never reaching unfollowPilot, when there is no session', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    const result = await unfollowPilotAction(900024)

    expect(result).toEqual({ status: 'error', message: 'Sign in to follow pilots.' })
    expect(mockUnfollowPilot).not.toHaveBeenCalled()
  })

  it('passes the authenticated userId and the given pilotId to unfollowPilot — never a client-supplied identity', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockUnfollowPilot.mockResolvedValue({ kind: 'unfollowed' })

    await unfollowPilotAction(900024)

    expect(mockUnfollowPilot).toHaveBeenCalledWith(expect.anything(), { userId: 'user-abc', pilotId: 900024 })
  })

  it('reports success when unfollowPilot succeeds', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockUnfollowPilot.mockResolvedValue({ kind: 'unfollowed' })

    const result = await unfollowPilotAction(900024)

    expect(result).toEqual({ status: 'success' })
  })

  it('surfaces a generic error when unfollowPilot hits a db error', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockUnfollowPilot.mockResolvedValue({ kind: 'db-error', message: 'raw db detail' })

    const result = await unfollowPilotAction(900024)

    expect(result).toEqual({ status: 'error', message: 'Something went wrong unfollowing this pilot. Try again.' })
  })

})

const TAKEOFF = { countryId: 160, takeoffId: 133 }

describe('followTakeoffAction name lookup', () => {
  beforeEach(() => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockFollowTakeoff.mockResolvedValue({ kind: 'followed' })
  })

  const storedNull = { userId: 'user-abc', countryId: 160, takeoffId: 133, name: null }

  it('stores the looked-up name for the takeoff ref', async () => {
    expect(await followTakeoffAction(TAKEOFF)).toEqual({ status: 'success' })
    expect(mockGetTakeoffDetail).toHaveBeenCalledWith(160, 133)
    expect(mockFollowTakeoff).toHaveBeenCalledWith(expect.anything(), { ...storedNull, name: 'Hamar' })
  })

  it('still follows with a null name when the lookup throws', async () => {
    mockGetTakeoffDetail.mockRejectedValue(new Error('flightlog.org down'))

    expect(await followTakeoffAction(TAKEOFF)).toEqual({ status: 'success' })
    expect(mockFollowTakeoff).toHaveBeenCalledWith(expect.anything(), storedNull)
  })

  it('still follows with a null name when flightlog has no such takeoff', async () => {
    mockGetTakeoffDetail.mockResolvedValue(null)

    expect(await followTakeoffAction(TAKEOFF)).toEqual({ status: 'success' })
    expect(mockFollowTakeoff).toHaveBeenCalledWith(expect.anything(), storedNull)
  })

  it('still follows with a null name when the lookup outlasts the timeout', async () => {
    vi.useFakeTimers()
    mockGetTakeoffDetail.mockReturnValue(new Promise(() => {}))

    const pending = followTakeoffAction(TAKEOFF)
    await vi.advanceTimersByTimeAsync(NAME_LOOKUP_TIMEOUT_MS)

    expect(await pending).toEqual({ status: 'success' })
    expect(mockFollowTakeoff).toHaveBeenCalledWith(expect.anything(), storedNull)
  })
})

describe.each([
  ['followTakeoffAction', followTakeoffAction, mockFollowTakeoff, { kind: 'followed' }, 'following'],
  ['unfollowTakeoffAction', unfollowTakeoffAction, mockUnfollowTakeoff, { kind: 'unfollowed' }, 'unfollowing'],
])('%s', (_name, action, mockLib, okResult, verb) => {
  it('rejects with a sign-in prompt and writes nothing when there is no session', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)
    mockLib.mockClear()

    expect(await action(TAKEOFF)).toEqual({ status: 'error', message: 'Sign in to follow takeoffs.' })
    expect(mockLib).not.toHaveBeenCalled()
  })

  it('passes the authenticated userId and the takeoff ref to the lib, never a client-supplied identity', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockLib.mockResolvedValue(okResult)

    expect(await action(TAKEOFF)).toEqual({ status: 'success' })
    expect(mockLib).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'user-abc', countryId: 160, takeoffId: 133 }))
  })

  it('surfaces a generic error on a db error', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockLib.mockResolvedValue({ kind: 'db-error', message: 'raw db detail' })

    expect(await action(TAKEOFF)).toEqual({
      status: 'error',
      message: `Something went wrong ${verb} this takeoff. Try again.`,
    })
  })
})
