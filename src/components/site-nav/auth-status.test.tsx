import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AuthStatus from './auth-status'

const mockGetUser = vi.fn()
const mockOnAuthStateChange = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      onAuthStateChange: mockOnAuthStateChange,
    },
  }),
}))

function stubAuthStateChange() {
  mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
}

describe('AuthStatus', () => {
  it('links to sign-in once the session read resolves to no user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    stubAuthStateChange()

    render(<AuthStatus />)

    const link = await screen.findByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toBe('/sign-in')
  })

  it('shows the signed-in email and a sign-out control once the session resolves to a user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'pilot@example.com' } } })
    stubAuthStateChange()

    render(<AuthStatus />)

    await screen.findByText('pilot@example.com')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('renders nothing while the initial session read is still pending', () => {
    mockGetUser.mockReturnValue(new Promise(() => {})) // never resolves
    stubAuthStateChange()

    render(<AuthStatus />)

    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByText('pilot@example.com')).toBeNull()
  })
})
