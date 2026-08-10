import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSupabaseEnv } from './env'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getSupabaseEnv', () => {
  it('returns null when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')

    expect(getSupabaseEnv()).toBeNull()
  })

  it('returns null when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

    expect(getSupabaseEnv()).toBeNull()
  })

  it('returns null when both vars are missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

    expect(getSupabaseEnv()).toBeNull()
  })

  it('returns the real values when both vars are present', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')

    expect(getSupabaseEnv()).toEqual({ url: 'https://example.supabase.co', anonKey: 'anon-key' })
  })
})
