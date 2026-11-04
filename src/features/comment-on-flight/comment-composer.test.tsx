import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SignedInUserState } from '@/lib/auth/use-signed-in-user'
import { CommentComposer } from './comment-composer'

const mockUseSignedInUser = vi.fn<() => SignedInUserState>()

vi.mock('@/lib/auth/use-signed-in-user', () => ({
  useSignedInUser: () => mockUseSignedInUser(),
}))

describe('CommentComposer', () => {
  it('renders nothing while the session is still loading', () => {
    mockUseSignedInUser.mockReturnValue({ kind: 'loading' })

    render(<CommentComposer tripId={1} />)

    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByLabelText('Add a comment')).toBeNull()
  })

  it('shows a sign-in prompt, not the form, when there is no session', () => {
    mockUseSignedInUser.mockReturnValue({ kind: 'signed-out' })

    render(<CommentComposer tripId={1} />)

    const link = screen.getByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toBe('/sign-in')
    expect(screen.queryByLabelText('Add a comment')).toBeNull()
  })

  it('shows the comment form when there is a session', () => {
    mockUseSignedInUser.mockReturnValue({ kind: 'signed-in', userId: 'user-abc', email: 'pilot@example.com' })

    render(<CommentComposer tripId={1} />)

    expect(screen.getByLabelText('Add a comment')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
  })
})
