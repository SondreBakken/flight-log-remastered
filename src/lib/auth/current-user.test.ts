// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHeaders = vi.fn()
const mockGetSession = vi.fn()

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}))

vi.mock('./server', () => ({
  getAuth: () => ({ api: { getSession: mockGetSession } }),
}))

import { getCurrentUserId } from './current-user'

const requestHeaders = new Headers({ cookie: 'better-auth.session_token=abc' })

beforeEach(() => {
  mockHeaders.mockResolvedValue(requestHeaders)
})

describe('getCurrentUserId', () => {
  it("returns the session user's id, looked up from the request's own headers", async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' }, session: { id: 'session-1' } })

    expect(await getCurrentUserId()).toBe('user-1')
    expect(mockGetSession).toHaveBeenCalledWith({ headers: requestHeaders })
  })

  it('returns null when the request carries no valid session', async () => {
    mockGetSession.mockResolvedValue(null)

    expect(await getCurrentUserId()).toBeNull()
  })

  it('reads the request headers before touching the auth instance', async () => {
    mockHeaders.mockRejectedValue(new Error('headers() outside a request scope'))

    await expect(getCurrentUserId()).rejects.toThrow('headers() outside a request scope')
    expect(mockGetSession).not.toHaveBeenCalled()
  })
})
