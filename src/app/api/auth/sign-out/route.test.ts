import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockSignOut = vi.fn()
vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({ api: { signOut: mockSignOut } }),
}))

import { POST } from './route'

const PUBLIC_ORIGIN = 'https://flightlog.example'

// request.url carries the internal origin the server sees behind the TLS proxy, not the public one.
function postFrom(headers: Record<string, string>) {
  return POST(new Request('http://internal:8080/api/auth/sign-out', { method: 'POST', headers }))
}

beforeEach(() => {
  vi.stubEnv('BETTER_AUTH_URL', PUBLIC_ORIGIN)
  mockSignOut.mockReset()
  mockSignOut.mockResolvedValue({ success: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/auth/sign-out', () => {
  it("signs out the session the request's own headers carry", async () => {
    await postFrom({ 'sec-fetch-site': 'same-origin', cookie: 'better-auth.session_token=abc' })

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    const [{ headers }] = mockSignOut.mock.calls[0] as [{ headers: Headers }]
    expect(headers.get('cookie')).toBe('better-auth.session_token=abc')
  })

  it('redirects to the public origin, not the internal request origin, with a 303', async () => {
    const response = await postFrom({ 'sec-fetch-site': 'same-origin' })

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/`)
  })

  it('treats an Origin header matching the public origin as same-origin when Sec-Fetch-Site is absent', async () => {
    const response = await postFrom({ origin: PUBLIC_ORIGIN })

    expect(response.status).toBe(303)
    expect(mockSignOut).toHaveBeenCalled()
  })

  it('rejects an Origin header matching only the internal request origin', async () => {
    const response = await postFrom({ origin: 'http://internal:8080' })

    expect(response.status).toBe(403)
    expect(mockSignOut).not.toHaveBeenCalled()
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
