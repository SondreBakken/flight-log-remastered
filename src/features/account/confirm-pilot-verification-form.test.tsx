import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfirmPilotVerificationForm } from './confirm-pilot-verification-form'

const mockConfirmPilotVerificationAction = vi.fn()

vi.mock('./actions', () => ({
  confirmPilotVerificationAction: (...args: unknown[]) => mockConfirmPilotVerificationAction(...args),
}))

function fillAndSubmit(code: string) {
  fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: code } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
}

describe('ConfirmPilotVerificationForm', () => {
  it('shows the inline error message the action returns, without calling onConfirmed', async () => {
    const onConfirmed = vi.fn()
    mockConfirmPilotVerificationAction.mockResolvedValue({
      status: 'error',
      message: 'That code is incorrect or has expired. Start verification again for a fresh code.',
    })

    render(<ConfirmPilotVerificationForm onConfirmed={onConfirmed} />)
    fillAndSubmit('000000')

    await screen.findByText('That code is incorrect or has expired. Start verification again for a fresh code.')
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  // The whole point of the callback (#177's own review follow-up): without it, a successful
  // confirm leaves the pending view (expiry copy + this same code input) on screen indefinitely,
  // and resubmitting the same code hits confirm_pilot_verification's own replay protection (its
  // hash was already cleared on the first, successful call) and reports "incorrect or expired" —
  // true of the resubmission, misleading about the confirm that actually succeeded.
  it('calls onConfirmed exactly once when the action reports success', async () => {
    const onConfirmed = vi.fn()
    mockConfirmPilotVerificationAction.mockResolvedValue({ status: 'success' })

    render(<ConfirmPilotVerificationForm onConfirmed={onConfirmed} />)
    fillAndSubmit('123456')

    await screen.findByText('Verified.')
    expect(onConfirmed).toHaveBeenCalledTimes(1)
  })

  it('does not call onConfirmed on mount, before any submission', () => {
    const onConfirmed = vi.fn()

    render(<ConfirmPilotVerificationForm onConfirmed={onConfirmed} />)

    expect(onConfirmed).not.toHaveBeenCalled()
  })

  it('works without a passed onConfirmed, since it is optional', async () => {
    mockConfirmPilotVerificationAction.mockResolvedValue({ status: 'success' })

    render(<ConfirmPilotVerificationForm />)
    fillAndSubmit('123456')

    await screen.findByText('Verified.')
  })

  it('disables the submit button while the action is pending', async () => {
    let resolveAction!: (state: { status: 'success' }) => void
    mockConfirmPilotVerificationAction.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)))

    render(<ConfirmPilotVerificationForm onConfirmed={vi.fn()} />)
    fillAndSubmit('123456')

    expect(await screen.findByRole('button', { name: 'Confirming…' })).toHaveProperty('disabled', true)

    resolveAction({ status: 'success' })
    await screen.findByRole('button', { name: 'Confirm' })
  })
})
