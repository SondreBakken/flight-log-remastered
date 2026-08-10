import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SignIn from './index'

const mockSignInWithOtp = vi.fn()
const mockCreateClient = vi.fn()
let mockSearchParams = new URLSearchParams()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mockCreateClient(),
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
  mockCreateClient.mockReturnValue({ auth: { signInWithOtp: mockSignInWithOtp } })
})

describe('SignIn', () => {
  it('sends a magic link and shows the confirmation once signInWithOtp succeeds', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })

    render(<SignIn />)
    fillAndSubmit('pilot@example.com')

    await screen.findByText('Check pilot@example.com for a sign-in link.')
    expect(mockSignInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'pilot@example.com' }),
    )
  })

  it('lets a visitor go back and retry with a different email from the confirmation state', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })

    render(<SignIn />)
    fillAndSubmit('typo@example.com')
    await screen.findByText('Check typo@example.com for a sign-in link.')

    fireEvent.click(screen.getByRole('button', { name: 'Use a different email' }))

    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.queryByText('Check typo@example.com for a sign-in link.')).toBeNull()
  })

  it('shows a generic error, not the raw Supabase error string, when signInWithOtp fails', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: 'rate limit exceeded for this ip' } })

    render(<SignIn />)
    fillAndSubmit('pilot@example.com')

    await screen.findByText(/something went wrong sending the sign-in link/i)
    expect(screen.queryByText('rate limit exceeded for this ip')).toBeNull()
  })

  it('shows a not-configured error, without crashing, when Supabase has no env vars set', async () => {
    mockCreateClient.mockImplementation(() => {
      throw new Error('Supabase is not configured')
    })

    render(<SignIn />)
    fillAndSubmit('pilot@example.com')

    await screen.findByText(/sign-in is not available right now/i)
    expect(mockSignInWithOtp).not.toHaveBeenCalled()
  })

  it('surfaces the callback route\'s auth-code-exchange-failed error on mount', () => {
    mockSearchParams = new URLSearchParams('error=auth-code-exchange-failed')

    render(<SignIn />)

    expect(screen.getByText(/that sign-in link didn't work/i)).toBeTruthy()
  })

  it('shows the plain sign-in form when no error param is present', () => {
    render(<SignIn />)

    expect(screen.getByLabelText('Email')).toBeTruthy()
  })
})
