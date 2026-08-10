import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockExchangeCodeForSession = vi.fn()
const mockCreateClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}))

import { GET } from './route'

beforeEach(() => {
  mockCreateClient.mockResolvedValue({ auth: { exchangeCodeForSession: mockExchangeCodeForSession } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /auth/callback', () => {
  it('redirects to the site root on a successful exchange, ignoring any next param', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null })

    const response = await GET(new Request('http://localhost/auth/callback?code=abc123&next=/evil.example'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/')
  })

  it('redirects to /sign-in with an error param and logs the failure when the exchange fails', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: new Error('invalid grant') })

    const response = await GET(new Request('http://localhost/auth/callback?code=abc123'))

    expect(response.headers.get('location')).toBe('http://localhost/sign-in?error=auth-code-exchange-failed')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('exchangeCodeForSession failed'), expect.any(Error))
  })

  it('redirects to /sign-in with an error param when there is no code at all', async () => {
    const response = await GET(new Request('http://localhost/auth/callback'))

    expect(response.headers.get('location')).toBe('http://localhost/sign-in?error=auth-code-exchange-failed')
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('redirects to /sign-in with an error param, without throwing, when Supabase is not configured', async () => {
    mockCreateClient.mockImplementation(() => {
      throw new Error('Supabase is not configured')
    })

    const response = await GET(new Request('http://localhost/auth/callback?code=abc123'))

    expect(response.headers.get('location')).toBe('http://localhost/sign-in?error=auth-code-exchange-failed')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not configured'), expect.any(Error))
  })
})
