import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ getDb: () => 'app-database' }))
vi.mock('./is-pilot-verified', () => ({ isPilotVerified: vi.fn() }))

import { isPilotVerified } from './is-pilot-verified'
import { ProfilesQueryError } from './profiles-query-error'
import { resolvePilotVerified } from './resolve-pilot-verified'

const mockedIsPilotVerified = vi.mocked(isPilotVerified)

const PILOT_ID = 12677

describe('resolvePilotVerified', () => {
  it('returns the public lookup result for the given pilot', async () => {
    mockedIsPilotVerified.mockResolvedValue(true)

    expect(await resolvePilotVerified(PILOT_ID)).toBe(true)
    expect(mockedIsPilotVerified).toHaveBeenCalledWith('app-database', PILOT_ID)
  })

  it('returns false instead of throwing when the lookup fails', async () => {
    mockedIsPilotVerified.mockRejectedValue(new ProfilesQueryError('lookup failed'))

    expect(await resolvePilotVerified(PILOT_ID)).toBe(false)
  })

  it('propagates a throw that is not a ProfilesQueryError', async () => {
    mockedIsPilotVerified.mockRejectedValue(new TypeError('mapping bug'))

    await expect(resolvePilotVerified(PILOT_ID)).rejects.toBeInstanceOf(TypeError)
  })
})
