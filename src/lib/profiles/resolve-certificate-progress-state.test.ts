import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/env', () => ({ getSupabaseEnv: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/auth/current-user', () => ({ getCurrentUserId: vi.fn() }))
vi.mock('./get-certificate-progress-by-pilot-id', () => ({ getCertificateProgressByPilotId: vi.fn() }))
vi.mock('./get-flightlog-pilot-ids', () => ({ getFlightlogPilotIds: vi.fn() }))

import { getSupabaseEnv } from '@/lib/supabase/env'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { getCertificateProgressByPilotId } from './get-certificate-progress-by-pilot-id'
import { getFlightlogPilotIds } from './get-flightlog-pilot-ids'
import { resolveCertificateProgressState } from './resolve-certificate-progress-state'
import { ProfilesQueryError } from './profiles-query-error'

const mockedGetSupabaseEnv = vi.mocked(getSupabaseEnv)
const mockedGetCurrentUserId = vi.mocked(getCurrentUserId)
const mockedGetCertificateProgressByPilotId = vi.mocked(getCertificateProgressByPilotId)
const mockedGetFlightlogPilotIds = vi.mocked(getFlightlogPilotIds)

const PILOT_ID = 12677


beforeEach(() => {
  mockedGetSupabaseEnv.mockReturnValue({} as ReturnType<typeof getSupabaseEnv>)
})

describe('resolveCertificateProgressState', () => {
  it('returns a null level and isOwner false when Supabase is not configured', async () => {
    mockedGetSupabaseEnv.mockReturnValue(null)

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state).toEqual({ isOwner: false, level: null, levelSetAt: null, checklist: {} })
    expect(mockedGetCertificateProgressByPilotId).not.toHaveBeenCalled()
  })

  it('returns the declared progress with isOwner false when the viewer is signed out', async () => {
    mockedGetCurrentUserId.mockResolvedValue(null)
    mockedGetCertificateProgressByPilotId.mockResolvedValue({ userId: 'user-1', level: 'PP3', levelSetAt: null, checklist: {} })

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state).toEqual({ isOwner: false, level: 'PP3', levelSetAt: null, checklist: {} })
    expect(mockedGetFlightlogPilotIds).not.toHaveBeenCalled()
  })

  it('returns isOwner true when the signed-in viewer\'s own linked pilot id matches', async () => {
    mockedGetCurrentUserId.mockResolvedValue('user-1')
    mockedGetCertificateProgressByPilotId.mockResolvedValue({ userId: 'user-1', level: 'PP3', levelSetAt: null, checklist: {} })
    mockedGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', PILOT_ID]]))

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state.isOwner).toBe(true)
  })

  it('returns isOwner false when the signed-in viewer\'s linked pilot id does not match', async () => {
    mockedGetCurrentUserId.mockResolvedValue('user-2')
    mockedGetCertificateProgressByPilotId.mockResolvedValue(null)
    mockedGetFlightlogPilotIds.mockResolvedValue(new Map([['user-2', 999999]]))

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state.isOwner).toBe(false)
  })

  it('defaults level/levelSetAt/checklist when no profile has declared this pilot id', async () => {
    mockedGetCurrentUserId.mockResolvedValue(null)
    mockedGetCertificateProgressByPilotId.mockResolvedValue(null)

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state).toEqual({ isOwner: false, level: null, levelSetAt: null, checklist: {} })
  })

  it('degrades to the default state instead of throwing when the query fails with ProfilesQueryError', async () => {
    mockedGetCurrentUserId.mockResolvedValue(null)
    mockedGetCertificateProgressByPilotId.mockRejectedValue(new ProfilesQueryError('boom'))

    const state = await resolveCertificateProgressState(PILOT_ID)

    expect(state).toEqual({ isOwner: false, level: null, levelSetAt: null, checklist: {} })
  })
})
