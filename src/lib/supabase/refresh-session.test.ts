import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetSupabaseEnv = vi.fn()
const mockCreateServerClient = vi.fn()

vi.mock('./env', () => ({
  getSupabaseEnv: () => mockGetSupabaseEnv(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => mockCreateServerClient(...args),
}))

import { updateSession } from './refresh-session'

describe('updateSession', () => {
  it('returns a pass-through response without constructing a Supabase client when unconfigured', async () => {
    mockGetSupabaseEnv.mockReturnValue(null)

    const request = new NextRequest('http://localhost/countries')
    const response = await updateSession(request)

    expect(mockCreateServerClient).not.toHaveBeenCalled()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('constructs a Supabase client and refreshes the session when configured', async () => {
    mockGetSupabaseEnv.mockReturnValue({ url: 'https://example.supabase.co', anonKey: 'anon-key' })
    const getUser = vi.fn().mockResolvedValue({ data: { user: null } })
    mockCreateServerClient.mockReturnValue({ auth: { getUser } })

    const request = new NextRequest('http://localhost/countries')
    const response = await updateSession(request)

    expect(mockCreateServerClient).toHaveBeenCalledWith('https://example.supabase.co', 'anon-key', expect.anything())
    expect(getUser).toHaveBeenCalled()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})
