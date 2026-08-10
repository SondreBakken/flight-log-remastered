import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import AuthStatus from './auth-status'

const mockOnAuthStateChange = vi.fn()
const mockGetSupabaseEnv = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { onAuthStateChange: mockOnAuthStateChange },
  }),
}))

vi.mock('@/lib/supabase/env', () => ({
  getSupabaseEnv: () => mockGetSupabaseEnv(),
}))

// Captures the callback AuthStatus registers with onAuthStateChange, so tests can drive it the
// way the real Supabase client would: fire once with the initial session state, then again on
// every sign-in/sign-out — see auth-status.tsx's doc comment on why state is driven entirely
// from this subscription rather than a separate getUser() call.
function stubAuthStateChange() {
  const unsubscribe = vi.fn()
  mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
  return unsubscribe
}

function emitAuthStateChange(session: { user: { email: string } } | null) {
  const onChange = mockOnAuthStateChange.mock.calls[0][0] as (event: string, session: unknown) => void
  act(() => {
    onChange('SIGNED_IN', session)
  })
}

beforeEach(() => {
  mockGetSupabaseEnv.mockReturnValue({ url: 'https://project.supabase.co', anonKey: 'anon-key' })
})

describe('AuthStatus', () => {
  it('renders nothing before the auth-state subscription reports anything', () => {
    stubAuthStateChange()

    render(<AuthStatus />)

    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('links to sign-in once the subscription reports no session', () => {
    stubAuthStateChange()
    render(<AuthStatus />)

    emitAuthStateChange(null)

    const link = screen.getByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toBe('/sign-in')
  })

  it('shows the signed-in email and a sign-out control once the subscription reports a session', () => {
    stubAuthStateChange()
    render(<AuthStatus />)

    emitAuthStateChange({ user: { email: 'pilot@example.com' } })

    expect(screen.getByText('pilot@example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('updates back to signed-out when a later event reports no session, even after being signed in', () => {
    stubAuthStateChange()
    render(<AuthStatus />)

    emitAuthStateChange({ user: { email: 'pilot@example.com' } })
    emitAuthStateChange(null)

    expect(screen.queryByText('pilot@example.com')).toBeNull()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy()
  })

  it('unsubscribes from the auth-state listener on unmount', () => {
    const unsubscribe = stubAuthStateChange()
    const { unmount } = render(<AuthStatus />)

    unmount()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('the sign-out control posts to the sign-out route', () => {
    stubAuthStateChange()
    render(<AuthStatus />)

    emitAuthStateChange({ user: { email: 'pilot@example.com' } })

    const form = screen.getByRole('button', { name: 'Sign out' }).closest('form')
    expect(form?.getAttribute('action')).toBe('/api/auth/sign-out')
    expect(form?.getAttribute('method')).toBe('post')
  })

  it('renders nothing and never touches the Supabase client when Supabase is not configured', () => {
    mockGetSupabaseEnv.mockReturnValue(null)

    render(<AuthStatus />)

    expect(mockOnAuthStateChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
  })
})
