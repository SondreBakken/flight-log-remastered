import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient, getSupabaseAdminEnv, requireSupabaseAdminEnv } from './admin'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getSupabaseAdminEnv', () => {
  it('returns null when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')

    expect(getSupabaseAdminEnv()).toBeNull()
  })

  it('returns null when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')

    expect(getSupabaseAdminEnv()).toBeNull()
  })

  it('returns null when both vars are missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')

    expect(getSupabaseAdminEnv()).toBeNull()
  })

  it('returns the real values when both vars are present', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')

    expect(getSupabaseAdminEnv()).toEqual({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-key',
    })
  })
})

describe('requireSupabaseAdminEnv', () => {
  it('throws when unconfigured', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')

    expect(() => requireSupabaseAdminEnv()).toThrow(
      'Supabase admin client is not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    )
  })

  it('returns the real values when both vars are present', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')

    expect(requireSupabaseAdminEnv()).toEqual({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-key',
    })
  })
})

describe('createAdminClient', () => {
  it('throws when unconfigured', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')

    expect(() => createAdminClient()).toThrow(
      'Supabase admin client is not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    )
  })

  it('builds a client when both vars are present, without making any network calls', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')

    expect(createAdminClient()).toBeTruthy()
  })
})
