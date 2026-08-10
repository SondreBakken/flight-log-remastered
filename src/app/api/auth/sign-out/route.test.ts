import { describe, expect, it, vi } from 'vitest'

const mockSignOut = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut: mockSignOut } }),
}))

import { POST } from './route'

function postFrom(headers: Record<string, string>) {
  return POST(new Request('http://localhost/api/auth/sign-out', { method: 'POST', headers }))
}

describe('POST /api/auth/sign-out', () => {
  it('signs out with local scope, not the default global scope, so other devices stay signed in', async () => {
    mockSignOut.mockResolvedValue({ error: null })

    await postFrom({ 'sec-fetch-site': 'same-origin' })

    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('redirects home with a 303 on a same-origin request', async () => {
    mockSignOut.mockResolvedValue({ error: null })

    const response = await postFrom({ 'sec-fetch-site': 'same-origin' })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/')
  })

  it('treats a matching Origin header as same-origin when Sec-Fetch-Site is absent', async () => {
    mockSignOut.mockResolvedValue({ error: null })

    const response = await postFrom({ origin: 'http://localhost' })

    expect(response.status).toBe(303)
    expect(mockSignOut).toHaveBeenCalled()
  })

  it('rejects a cross-site request (Sec-Fetch-Site: cross-site) with 403, without calling signOut', async () => {
    const response = await postFrom({ 'sec-fetch-site': 'cross-site' })

    expect(response.status).toBe(403)
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('rejects a request with a mismatched Origin header with 403, without calling signOut', async () => {
    const response = await postFrom({ origin: 'https://evil.example' })

    expect(response.status).toBe(403)
    expect(mockSignOut).not.toHaveBeenCalled()
  })

  it('rejects a request carrying neither Sec-Fetch-Site nor Origin with 403, without calling signOut', async () => {
    const response = await postFrom({})

    expect(response.status).toBe(403)
    expect(mockSignOut).not.toHaveBeenCalled()
  })
})
