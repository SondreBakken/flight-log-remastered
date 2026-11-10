import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUserId: vi.fn() }))
vi.mock('@/lib/profiles/get-own-pilot-verification', () => ({ getOwnPilotVerification: vi.fn() }))

import { getCurrentUserId } from '@/lib/auth/current-user'
import { getOwnPilotVerification, type PilotVerification } from '@/lib/profiles/get-own-pilot-verification'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'
import { GET } from './route'

const mockedGetCurrentUserId = vi.mocked(getCurrentUserId)
const mockedGetOwnPilotVerification = vi.mocked(getOwnPilotVerification)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/account/verification', () => {
  it.each<[PilotVerification, string]>([
    [{ kind: 'none' }, 'none'],
    [{ kind: 'pending', email: 'secret@example.com', otpExpiresAt: new Date('2026-01-01') }, 'pending'],
    [{ kind: 'verified' }, 'verified'],
  ])("answers only the status of the session user's own verification (%j)", async (verification, status) => {
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetOwnPilotVerification.mockResolvedValue(verification)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockedGetOwnPilotVerification).toHaveBeenCalledWith(expect.anything(), 'user-1')
  })

  it('rejects a signed-out request without reading any verification', async () => {
    mockedGetCurrentUserId.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'signed-out' })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mockedGetOwnPilotVerification).not.toHaveBeenCalled()
  })

  it('answers 503, not a none status, when the verification lookup fails', async () => {
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetOwnPilotVerification.mockRejectedValue(new ProfilesQueryError('boom'))

    const response = await GET()

    expect(response.status).toBe(503)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('lets an unexpected error propagate', async () => {
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetOwnPilotVerification.mockRejectedValue(new TypeError('bug'))

    await expect(GET()).rejects.toBeInstanceOf(TypeError)
  })
})
