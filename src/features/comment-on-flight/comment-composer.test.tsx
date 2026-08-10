import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { CommentComposer } from './comment-composer'

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

// Same seam as src/components/site-nav/auth-status.test.tsx (use-signed-in-user.ts mirrors
// AuthStatus's own subscription pattern) — captures the callback registered with
// onAuthStateChange so tests can drive it the way the real Supabase client would.
function stubAuthStateChange() {
  const unsubscribe = vi.fn()
  mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
  return unsubscribe
}

function emitAuthStateChange(session: { user: { id: string } } | null) {
  const onChange = mockOnAuthStateChange.mock.calls[0][0] as (event: string, session: unknown) => void
  act(() => {
    onChange('SIGNED_IN', session)
  })
}

beforeEach(() => {
  mockGetSupabaseEnv.mockReturnValue({ url: 'https://project.supabase.co', anonKey: 'anon-key' })
})

describe('CommentComposer', () => {
  it('renders nothing before the auth-state subscription reports anything', () => {
    stubAuthStateChange()

    render(<CommentComposer tripId={1} />)

    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByLabelText('Add a comment')).toBeNull()
  })

  it('shows a sign-in prompt, not the form, once the subscription reports no session', () => {
    stubAuthStateChange()
    render(<CommentComposer tripId={1} />)

    emitAuthStateChange(null)

    const link = screen.getByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toBe('/sign-in')
    expect(screen.queryByLabelText('Add a comment')).toBeNull()
  })

  it('shows the comment form once the subscription reports a session', () => {
    stubAuthStateChange()
    render(<CommentComposer tripId={1} />)

    emitAuthStateChange({ user: { id: 'user-abc' } })

    expect(screen.getByLabelText('Add a comment')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
  })

  it('renders nothing and never touches the Supabase client when Supabase is not configured', () => {
    mockGetSupabaseEnv.mockReturnValue(null)

    render(<CommentComposer tripId={1} />)

    expect(mockOnAuthStateChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByLabelText('Add a comment')).toBeNull()
  })
})
