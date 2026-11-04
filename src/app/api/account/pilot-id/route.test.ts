import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUserId: vi.fn() }))
vi.mock('@/lib/profiles/get-profile', () => ({ getProfile: vi.fn() }))

import { getCurrentUserId } from '@/lib/auth/current-user'
import { getProfile } from '@/lib/profiles/get-profile'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'
import { GET } from './route'

const mockedGetCurrentUserId = vi.mocked(getCurrentUserId)
const mockedGetProfile = vi.mocked(getProfile)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/account/pilot-id', () => {
  it("answers with the session user's own linked pilot id, uncacheable", async () => {
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetProfile.mockResolvedValue({ displayName: 'Alex', flightlogPilotId: 12677 })

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ pilotId: 12677 })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockedGetProfile).toHaveBeenCalledWith(expect.anything(), 'user-1')
  })

  it('answers with a null pilot id when none is linked', async () => {
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: null })

    expect(await (await GET()).json()).toEqual({ pilotId: null })
  })

  it('rejects a signed-out request without reading any profile', async () => {
    mockedGetCurrentUserId.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(mockedGetProfile).not.toHaveBeenCalled()
  })

  it('answers 503, not a null pilot id, when the profile lookup fails', async () => {
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetProfile.mockRejectedValue(new ProfilesQueryError('boom'))

    expect((await GET()).status).toBe(503)
  })
})
