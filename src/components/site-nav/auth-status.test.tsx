import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { SignedInUserState } from '@/lib/auth/use-signed-in-user'
import { notifyOwnVerificationChanged } from '@/lib/profiles/own-verification-changed'
import AuthStatus from './auth-status'

const mockUseSignedInUser = vi.fn<() => SignedInUserState>()
const mockFetchOwnVerification = vi.fn()

vi.mock('@/lib/auth/use-signed-in-user', () => ({
  useSignedInUser: () => mockUseSignedInUser(),
}))

vi.mock('./fetch-own-verification', () => ({
  fetchOwnVerification: () => mockFetchOwnVerification(),
}))

const SIGNED_IN: SignedInUserState = { kind: 'signed-in', userId: 'user-1', email: 'pilot@example.com' }

beforeEach(() => {
  mockFetchOwnVerification.mockResolvedValue('none')
})

function expectMutedIconAndEmailOnUnmutedLink() {
  const link = document.querySelector('a[href="/account"]')!
  expect(link.className).not.toContain('opacity-70')
  expect(link.querySelector('svg')?.getAttribute('class')).toContain('opacity-70')
  expect(link.querySelector('span')?.className).toContain('opacity-70')
}

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

  it('shows a flat 16 px stamp next to the email once the verification is confirmed', async () => {
    mockFetchOwnVerification.mockResolvedValue('verified')
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    const stamp = await screen.findByRole('img', { name: 'Verified pilot' })
    expect(stamp.closest('a')?.getAttribute('href')).toBe('/account')
    expect(stamp.className).not.toContain('-rotate-6')
    expect(stamp.querySelector('svg')?.getAttribute('width')).toBe('16')
  })

  it('keeps the stamp at full opacity: opacity-70 sits on the icon and email, not the link or any ancestor (#310)', async () => {
    mockFetchOwnVerification.mockResolvedValue('verified')
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    const stamp = await screen.findByRole('img', { name: 'Verified pilot' })
    const link = stamp.closest('a')!
    expect(link.getAttribute('href')).toBe('/account')
    for (let el: Element | null = stamp; el; el = el.parentElement) {
      expect(el.className.toString()).not.toMatch(/\bopacity-/)
    }
    expect(link.querySelector('svg')?.getAttribute('class')).toContain('opacity-70')
    expect(screen.getByText('pilot@example.com').className).toContain('opacity-70')
  })

  it.each(['none', 'pending'])('still mutes the icon and email, link unmuted, with a %s verification', async (status) => {
    mockFetchOwnVerification.mockResolvedValue(status)
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    await waitFor(() => expect(mockFetchOwnVerification).toHaveBeenCalled())
    const link = screen.getByText('pilot@example.com').closest('a')!
    expect(link.className).not.toContain('opacity-70')
    expect(link.querySelector('svg')?.getAttribute('class')).toContain('opacity-70')
    expect(screen.getByText('pilot@example.com').className).toContain('opacity-70')
  })

  it.each(['a-very-long-pilot-address-that-will-truncate@example.com', ''])('mutes the label span for the email %j', (email) => {
    mockUseSignedInUser.mockReturnValue({ ...SIGNED_IN, email })

    render(<AuthStatus />)

    expectMutedIconAndEmailOnUnmutedLink()
  })

  it.each(['none', 'pending'])('shows no stamp for a %s verification', async (status) => {
    mockFetchOwnVerification.mockResolvedValue(status)
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    await waitFor(() => expect(mockFetchOwnVerification).toHaveBeenCalled())
    expect(screen.queryByRole('img', { name: 'Verified pilot' })).toBeNull()
  })

  it('shows no stamp while the verification is still loading', () => {
    mockFetchOwnVerification.mockReturnValue(new Promise(() => {}))
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    expect(screen.queryByRole('img', { name: 'Verified pilot' })).toBeNull()
    expectMutedIconAndEmailOnUnmutedLink()
  })

  it('shows no stamp, and logs, when the verification lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchOwnVerification.mockRejectedValue(new Error('/api/account/verification answered 503'))
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)

    render(<AuthStatus />)

    await waitFor(() => expect(consoleError).toHaveBeenCalled())
    expect(screen.queryByRole('img', { name: 'Verified pilot' })).toBeNull()
    expectMutedIconAndEmailOnUnmutedLink()
    consoleError.mockRestore()
  })

  it('shows no stamp and fetches nothing when signed out', () => {
    mockUseSignedInUser.mockReturnValue({ kind: 'signed-out' })

    render(<AuthStatus />)

    expect(mockFetchOwnVerification).not.toHaveBeenCalled()
    expect(screen.queryByRole('img', { name: 'Verified pilot' })).toBeNull()
  })

  it('shows and hides the stamp as the verification changes, without a reload', async () => {
    mockFetchOwnVerification.mockResolvedValueOnce('pending').mockResolvedValueOnce('verified').mockResolvedValueOnce('none')
    mockUseSignedInUser.mockReturnValue(SIGNED_IN)
    render(<AuthStatus />)
    await waitFor(() => expect(mockFetchOwnVerification).toHaveBeenCalledTimes(1))

    await act(async () => notifyOwnVerificationChanged())
    await screen.findByRole('img', { name: 'Verified pilot' })

    await act(async () => notifyOwnVerificationChanged())
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Verified pilot' })).toBeNull())
  })

  it('keeps every signed-out and signed-in control findable by name with a sr-only-below-sm label', () => {
    mockUseSignedInUser.mockReturnValue({ kind: 'signed-out' })
    const signedOut = render(<AuthStatus />)
    expect(screen.getByText('Sign in').className).toContain('sr-only sm:not-sr-only')
    expect(screen.getByRole('link', { name: 'Sign in' }).className).toContain('whitespace-nowrap')
    signedOut.unmount()

    mockUseSignedInUser.mockReturnValue(SIGNED_IN)
    render(<AuthStatus />)

    for (const name of ['pilot@example.com', 'Sign out']) {
      const label = screen.getByText(name)
      expect(label.className).toContain('sr-only')
      expect(label.className).toContain('sm:not-sr-only')
    }
    expect(screen.getByText('pilot@example.com').className).toContain('sm:truncate')
    expect(screen.getByRole('button', { name: 'Sign out' }).className).toContain('whitespace-nowrap')
  })
})
