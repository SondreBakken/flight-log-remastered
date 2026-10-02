import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/env', () => ({ getSupabaseEnv: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('./is-pilot-verified', () => ({ isPilotVerified: vi.fn() }))

import { getSupabaseEnv } from '@/lib/supabase/env'
import { createClient } from '@/lib/supabase/server'
import { isPilotVerified } from './is-pilot-verified'
import { ProfilesQueryError } from './profiles-query-error'
import { resolvePilotVerified } from './resolve-pilot-verified'

const mockedGetSupabaseEnv = vi.mocked(getSupabaseEnv)
const mockedCreateClient = vi.mocked(createClient)
const mockedIsPilotVerified = vi.mocked(isPilotVerified)

const PILOT_ID = 12677

beforeEach(() => {
  mockedGetSupabaseEnv.mockReturnValue({} as ReturnType<typeof getSupabaseEnv>)
  mockedCreateClient.mockResolvedValue({} as Awaited<ReturnType<typeof createClient>>)
})

describe('resolvePilotVerified', () => {
  it('returns false without querying when Supabase is not configured', async () => {
    mockedGetSupabaseEnv.mockReturnValue(null)

    expect(await resolvePilotVerified(PILOT_ID)).toBe(false)
    expect(mockedIsPilotVerified).not.toHaveBeenCalled()
  })

  it('returns the lookup result for the given pilot', async () => {
    mockedIsPilotVerified.mockResolvedValue(true)

    expect(await resolvePilotVerified(PILOT_ID)).toBe(true)
    expect(mockedIsPilotVerified).toHaveBeenCalledWith(expect.anything(), PILOT_ID)
  })

  it('returns false instead of throwing when the lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockedIsPilotVerified.mockRejectedValue(new ProfilesQueryError('rpc failed'))

    expect(await resolvePilotVerified(PILOT_ID)).toBe(false)

    consoleError.mockRestore()
  })

  it('propagates a throw that is not a ProfilesQueryError', async () => {
    mockedIsPilotVerified.mockRejectedValue(new TypeError('mapping bug'))

    await expect(resolvePilotVerified(PILOT_ID)).rejects.toBeInstanceOf(TypeError)
  })
})
