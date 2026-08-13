import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PilotVerification } from './pilot-verification'
import type { OwnPilotVerificationStatusState } from './use-own-pilot-verification-status'

const mockStartPilotVerificationAction = vi.fn()

vi.mock('./actions', () => ({
  startPilotVerificationAction: (...args: unknown[]) => mockStartPilotVerificationAction(...args),
  // confirmPilotVerificationAction is imported transitively via ConfirmPilotVerificationForm,
  // rendered only in the 'pending' branch below — stubbed here so that render doesn't need a real
  // useActionState-bound action.
  confirmPilotVerificationAction: vi.fn(),
}))

beforeEach(() => {
  mockStartPilotVerificationAction.mockReset()
})

describe('PilotVerification, loading/error', () => {
  it('renders nothing while status is loading', () => {
    const { container } = render(<PilotVerification onVerificationStarted={vi.fn()} status={{ kind: 'loading' }} />)
    expect(container.textContent).toBe('')
  })

  it('shows a distinct failure notice, not a blank or "none" render, when status is error', () => {
    render(<PilotVerification onVerificationStarted={vi.fn()} status={{ kind: 'error' }} />)
    expect(screen.getByText(/Couldn't load your pilot id verification status/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PilotVerification, none', () => {
  it('renders a "Verify your pilot id" trigger with no warning', () => {
    render(<PilotVerification onVerificationStarted={vi.fn()} status={{ kind: 'none' }} />)
    expect(screen.getByRole('button', { name: 'Verify your pilot id' })).toBeTruthy()
  })

  it('calls startPilotVerificationAction on click and notifies the parent once it settles', async () => {
    const onVerificationStarted = vi.fn()
    mockStartPilotVerificationAction.mockResolvedValue({ status: 'success' })

    render(<PilotVerification onVerificationStarted={onVerificationStarted} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await vi.waitFor(() => expect(onVerificationStarted).toHaveBeenCalledTimes(1))
    expect(mockStartPilotVerificationAction).toHaveBeenCalledTimes(1)
  })

  it('disables the button and shows a starting label while the action is pending', async () => {
    let resolveAction!: (result: { status: 'success' }) => void
    mockStartPilotVerificationAction.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)))

    render(<PilotVerification onVerificationStarted={vi.fn()} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
    expect(screen.getByText('Starting…')).toBeTruthy()

    resolveAction({ status: 'success' })
    await screen.findByRole('button', { name: 'Verify your pilot id' })
  })

  it('shows the inline error message returned by the action, still calling onVerificationStarted (send-failed still writes a pending row)', async () => {
    const onVerificationStarted = vi.fn()
    mockStartPilotVerificationAction.mockResolvedValue({
      status: 'error',
      message: 'Your verification code was generated, but we could not email it. Try again in a moment.',
    })

    render(<PilotVerification onVerificationStarted={onVerificationStarted} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Your verification code was generated, but we could not email it. Try again in a moment.')
    expect(onVerificationStarted).toHaveBeenCalledTimes(1)
  })

  it('shows the started-logged info message distinctly from an error', async () => {
    mockStartPilotVerificationAction.mockResolvedValue({
      status: 'started-logged',
      message: 'Verification started. Check the server log for your code.',
    })

    render(<PilotVerification onVerificationStarted={vi.fn()} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button'))

    const info = await screen.findByText('Verification started. Check the server log for your code.')
    expect(info.className).not.toContain('text-red-600')
  })
})

describe('PilotVerification, verified', () => {
  it('renders a "Re-verify" trigger with a warning about the temporary reset (#184)', () => {
    render(<PilotVerification onVerificationStarted={vi.fn()} status={{ kind: 'verified' }} />)
    expect(screen.getByRole('button', { name: 'Re-verify' })).toBeTruthy()
    expect(screen.getByText(/temporarily un-verifies your pilot id/)).toBeTruthy()
  })

  it('does not render the "verified" warning under the "none" status, pinning the two branches are distinct', () => {
    render(<PilotVerification onVerificationStarted={vi.fn()} status={{ kind: 'none' }} />)
    expect(screen.queryByText(/temporarily un-verifies your pilot id/)).toBeNull()
  })
})

describe('PilotVerification, pending', () => {
  const pendingStatus: OwnPilotVerificationStatusState = {
    kind: 'pending',
    otpExpiresAt: '2026-08-13T10:32:00.000Z',
    email: 'pilot@example.com',
  }

  it('shows the email the code was sent to and renders the confirm-code form, not the start trigger', () => {
    render(<PilotVerification onVerificationStarted={vi.fn()} status={pendingStatus} />)

    expect(screen.getByText(/pilot@example.com/)).toBeTruthy()
    expect(screen.getByLabelText('Verification code')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Verify your pilot id' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Re-verify' })).toBeNull()
  })
})
