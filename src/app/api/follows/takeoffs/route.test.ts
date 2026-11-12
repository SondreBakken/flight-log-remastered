import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUserId: vi.fn() }))
vi.mock('@/lib/follows/get-followed-takeoffs', () => ({ getFollowedTakeoffs: vi.fn() }))

import { getCurrentUserId } from '@/lib/auth/current-user'
import { FollowsQueryError } from '@/lib/follows/follows-query-error'
import { getFollowedTakeoffs } from '@/lib/follows/get-followed-takeoffs'
import { GET } from './route'

const mockedGetCurrentUserId = vi.mocked(getCurrentUserId)
const mockedGetFollowedTakeoffs = vi.mocked(getFollowedTakeoffs)

const PRIVATE_NO_STORE = 'private, no-store'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/follows/takeoffs', () => {
  it("answers with the session user's own followed takeoffs, uncacheable", async () => {
    const takeoffs = [
      { countryId: 160, takeoffId: 133 },
      { countryId: 203, takeoffId: 7 },
    ]
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetFollowedTakeoffs.mockResolvedValue(takeoffs)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ takeoffs })
    expect(response.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE)
    expect(mockedGetFollowedTakeoffs).toHaveBeenCalledWith(expect.anything(), 'user-1')
  })

  it('rejects a signed-out request without reading any follows, uncacheable', async () => {
    mockedGetCurrentUserId.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'signed-out' })
    expect(response.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE)
    expect(mockedGetFollowedTakeoffs).not.toHaveBeenCalled()
  })

  it('answers 503, not an empty list, when the follows lookup fails, uncacheable', async () => {
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetFollowedTakeoffs.mockRejectedValue(new FollowsQueryError('boom'))

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'follows-unavailable' })
    expect(response.headers.get('Cache-Control')).toBe(PRIVATE_NO_STORE)
  })

  it('rethrows an error that is not a follows query error', async () => {
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetFollowedTakeoffs.mockRejectedValue(new Error('bug'))

    await expect(GET()).rejects.toThrow('bug')
  })
})
