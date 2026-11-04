import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SignIn from './index'

const mockSignInMagicLink = vi.fn()
let mockSearchParams = new URLSearchParams()

vi.mock('@/lib/auth/client', () => ({
  authClient: { signIn: { magicLink: (...args: unknown[]) => mockSignInMagicLink(...args) } },
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

function fillAndSubmit(email: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Send magic link' }))
}

beforeEach(() => {
  mockSearchParams = new URLSearchParams()
  mockSignInMagicLink.mockReset()
})

describe('SignIn', () => {
  it('requests a magic link with relative callback URLs and shows the confirmation', async () => {
    mockSignInMagicLink.mockResolvedValue({ data: { status: true }, error: null })

    render(<SignIn />)
    fillAndSubmit('pilot@example.com')

    await screen.findByText('Check pilot@example.com for a sign-in link.')
    expect(mockSignInMagicLink).toHaveBeenCalledWith({
      email: 'pilot@example.com',
      callbackURL: '/',
      errorCallbackURL: '/sign-in',
    })
  })

  it('lets a visitor go back and retry with a different email from the confirmation state', async () => {
    mockSignInMagicLink.mockResolvedValue({ data: { status: true }, error: null })

    render(<SignIn />)
    fillAndSubmit('typo@example.com')
    await screen.findByText('Check typo@example.com for a sign-in link.')

    fireEvent.click(screen.getByRole('button', { name: 'Use a different email' }))

    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.queryByText('Check typo@example.com for a sign-in link.')).toBeNull()
  })

  it('shows a generic error, not the raw auth error, when the request fails', async () => {
    mockSignInMagicLink.mockResolvedValue({ data: null, error: { status: 429, message: 'Too many requests' } })

    render(<SignIn />)
    fillAndSubmit('pilot@example.com')

    await screen.findByText(/something went wrong sending the sign-in link/i)
    expect(screen.queryByText('Too many requests')).toBeNull()
  })

  it('shows the generic error instead of hanging on "Sending…" when the request rejects', async () => {
    mockSignInMagicLink.mockRejectedValue(new TypeError('Failed to fetch'))

    render(<SignIn />)
    fillAndSubmit('pilot@example.com')

    await screen.findByText(/something went wrong sending the sign-in link/i)
  })

  it("surfaces Better Auth's INVALID_TOKEN verify error on mount", () => {
    mockSearchParams = new URLSearchParams('error=INVALID_TOKEN')

    render(<SignIn />)

    expect(screen.getByText(/that sign-in link didn't work/i)).toBeTruthy()
  })

  it('falls back to a generic message for an unknown error code', () => {
    mockSearchParams = new URLSearchParams('error=failed_to_create_session')

    render(<SignIn />)

    expect(screen.getByText('Sign-in failed. Try again.')).toBeTruthy()
  })

  it('shows the plain sign-in form when no error param is present', () => {
    render(<SignIn />)

    expect(screen.getByLabelText('Email')).toBeTruthy()
  })

  it('shows a leading icon on the "Send magic link" button', () => {
    const { container } = render(<SignIn />)

    expect(container.querySelector('svg')).toBeTruthy()
  })
})
