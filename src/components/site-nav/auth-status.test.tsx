import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { SignedInUserState } from '@/lib/auth/use-signed-in-user'
import AuthStatus from './auth-status'

const mockUseSignedInUser = vi.fn<() => SignedInUserState>()
const mockGetFlightlogPilotIds = vi.fn()

vi.mock('@/lib/auth/use-signed-in-user', () => ({
  useSignedInUser: () => mockUseSignedInUser(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({}),
}))

vi.mock('@/lib/profiles/get-flightlog-pilot-ids', () => ({
  getFlightlogPilotIds: (...args: unknown[]) => mockGetFlightlogPilotIds(...args),
}))

const SIGNED_IN: SignedInUserState = { kind: 'signed-in', userId: 'user-1', email: 'pilot@example.com' }

beforeEach(() => {
  // Default: no pilot id linked, so tests asserting on the account link / sign-out control
  // (which predate the "My flights" link below) don't also have to account for it.
  mockGetFlightlogPilotIds.mockResolvedValue(new Map())
})

describe('AuthStatus', () => {
  it('renders nothing while the session is still loading', () => {
    mockUseSignedInUser.mockReturnValue({ kind: 'loading' })

    render(<AuthStatus />)

    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('links to sign-in when there is no session', () => {
    mockUseSignedInUser.mockReturnValue({ kind: 'signed-out' })

    render(<AuthStatus />)

    const link = screen.getByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toBe('/sign-in')
  })

  it('shows the signed-in email and a sign-out control when there is a session', () => {
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    expect(screen.getByText('pilot@example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('links the signed-in email to the account page', () => {
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    const link = screen.getByRole('link', { name: 'pilot@example.com' })
    expect(link.getAttribute('href')).toBe('/account')
  })

  it('updates back to signed-out when the session goes away, even after being signed in', () => {
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)
    const { rerender } = render(<AuthStatus />)

    mockUseSignedInUser.mockReturnValue({ kind: 'signed-out' })
    rerender(<AuthStatus />)

    expect(screen.queryByText('pilot@example.com')).toBeNull()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy()
  })

  it('the sign-out control posts to the sign-out route', () => {
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    const form = screen.getByRole('button', { name: 'Sign out' }).closest('form')
    expect(form?.getAttribute('action')).toBe('/api/auth/sign-out')
    expect(form?.getAttribute('method')).toBe('post')
  })

  it('shows an icon on the sign-in link', () => {
    mockUseSignedInUser.mockReturnValue({ kind: 'signed-out' })

    const { container } = render(<AuthStatus />)

    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('shows icons on the account link and the sign-out button', () => {
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    const { container } = render(<AuthStatus />)

    expect(container.querySelectorAll('svg').length).toBe(2)
  })

  it('links to the pilot page once a linked pilot id resolves (#243)', async () => {
    mockGetFlightlogPilotIds.mockResolvedValue(new Map([['user-1', 12677]]))
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    const link = await screen.findByRole('link', { name: 'My flights' })
    expect(link.getAttribute('href')).toBe('/pilots/12677')
  })

  it('does not show a "My flights" link when no pilot id is linked', async () => {
    mockGetFlightlogPilotIds.mockResolvedValue(new Map())
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    await waitFor(() => expect(mockGetFlightlogPilotIds).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: 'My flights' })).toBeNull()
  })

  it('surfaces a failed pilot id lookup instead of silently hiding the link', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetFlightlogPilotIds.mockRejectedValue(new Error('profiles query failed'))
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    await screen.findByTitle('Could not load your pilot id')
    expect(screen.queryByRole('link', { name: 'My flights' })).toBeNull()
    consoleError.mockRestore()
  })
})
