import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ getDb: () => ({}) }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUserId: vi.fn() }))
vi.mock('./get-certificate-progress-by-pilot-id', () => ({ getCertificateProgressByPilotId: vi.fn() }))
vi.mock('./get-profile', () => ({ getProfile: vi.fn() }))

import { getCurrentUserId } from '@/lib/auth/current-user'
import { getCertificateProgressByPilotId } from './get-certificate-progress-by-pilot-id'
import { getProfile } from './get-profile'
import { resolveCertificateProgressState } from './resolve-certificate-progress-state'
import { ProfilesQueryError } from './profiles-query-error'

const mockedGetCurrentUserId = vi.mocked(getCurrentUserId)
const mockedGetCertificateProgressByPilotId = vi.mocked(getCertificateProgressByPilotId)
const mockedGetProfile = vi.mocked(getProfile)

const PILOT_ID = 12677
const DEFAULT_STATE = { isOwner: false, level: null, levelSetAt: null, checklist: {} }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveCertificateProgressState', () => {
  it('returns the declared progress with isOwner false when the viewer is signed out', async () => {
    mockedGetCurrentUserId.mockResolvedValue(null)
    mockedGetCertificateProgressByPilotId.mockResolvedValue({ userId: 'user-1', level: 'PP3', levelSetAt: null, checklist: {} })

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state).toEqual({ isOwner: false, level: 'PP3', levelSetAt: null, checklist: {} })
    expect(mockedGetProfile).not.toHaveBeenCalled()
  })

  it("returns isOwner true when the signed-in viewer's own linked pilot id matches", async () => {
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetCertificateProgressByPilotId.mockResolvedValue({ userId: 'user-1', level: 'PP3', levelSetAt: null, checklist: {} })
    mockedGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: PILOT_ID })

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state.isOwner).toBe(true)
    expect(mockedGetProfile).toHaveBeenCalledWith(expect.anything(), 'user-1')
  })

  it("returns isOwner false when the signed-in viewer's linked pilot id does not match", async () => {
    mockedGetCurrentUserId.mockResolvedValue('user-2')
    mockedGetCertificateProgressByPilotId.mockResolvedValue(null)
    mockedGetProfile.mockResolvedValue({ displayName: null, flightlogPilotId: 999999 })

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state.isOwner).toBe(false)
  })

  it('defaults level/levelSetAt/checklist when no profile has declared this pilot id', async () => {
    mockedGetCurrentUserId.mockResolvedValue(null)
    mockedGetCertificateProgressByPilotId.mockResolvedValue(null)

    expect(await resolveCertificateProgressState(PILOT_ID)).toEqual(DEFAULT_STATE)
  })

  it('degrades to the default state instead of throwing when a profiles query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetCertificateProgressByPilotId.mockResolvedValue({ userId: 'user-1', level: 'PP3', levelSetAt: null, checklist: {} })
    mockedGetProfile.mockRejectedValue(new ProfilesQueryError('boom'))

    expect(await resolveCertificateProgressState(PILOT_ID)).toEqual(DEFAULT_STATE)
  })

  it('propagates a throw that is not a ProfilesQueryError', async () => {
    mockedGetCurrentUserId.mockResolvedValue(null)
    mockedGetCertificateProgressByPilotId.mockRejectedValue(new TypeError('mapping bug'))

    await expect(resolveCertificateProgressState(PILOT_ID)).rejects.toBeInstanceOf(TypeError)
  })
})
