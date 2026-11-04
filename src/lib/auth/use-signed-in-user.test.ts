import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const mockUseSession = vi.fn()

vi.mock('./client', () => ({
  authClient: { useSession: () => mockUseSession() },
}))

import { useSignedInUser } from './use-signed-in-user'

describe('useSignedInUser', () => {
  it('is loading while the session request is pending', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true, error: null })

    expect(renderHook(() => useSignedInUser()).result.current).toEqual({ kind: 'loading' })
  })

  it('is signed out when the session request resolves without a session', () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false, error: null })

    expect(renderHook(() => useSignedInUser()).result.current).toEqual({ kind: 'signed-out' })
  })

  it("is signed in with the session user's id and email", () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-1', email: 'pilot@example.com' }, session: { id: 'session-1' } },
      isPending: false,
      error: null,
    })

    expect(renderHook(() => useSignedInUser()).result.current).toEqual({
      kind: 'signed-in',
      userId: 'user-1',
      email: 'pilot@example.com',
    })
  })
})
