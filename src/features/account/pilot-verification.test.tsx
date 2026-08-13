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
    const { container } = render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'loading' }} />)
    expect(container.textContent).toBe('')
  })

  it('shows a distinct failure notice, not a blank or "none" render, when status is error', () => {
    render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'error' }} />)
    expect(screen.getByText(/Couldn't load your pilot id verification status/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PilotVerification, none', () => {
  it('renders a "Verify your pilot id" trigger with no warning', () => {
    render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)
    expect(screen.getByRole('button', { name: 'Verify your pilot id' })).toBeTruthy()
  })

  it('calls startPilotVerificationAction on click and notifies the parent once it settles', async () => {
    const onStatusChanged = vi.fn()
    mockStartPilotVerificationAction.mockResolvedValue({ status: 'success' })

    render(<PilotVerification onStatusChanged={onStatusChanged} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await vi.waitFor(() => expect(onStatusChanged).toHaveBeenCalledTimes(1))
    expect(mockStartPilotVerificationAction).toHaveBeenCalledTimes(1)
  })

  it('disables the button and shows a starting label while the request itself is in flight', async () => {
    let resolveAction!: (result: { status: 'success' }) => void
    mockStartPilotVerificationAction.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)))

    render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
    expect(screen.getByText('Starting…')).toBeTruthy()

    resolveAction({ status: 'success' })
    // The label reverts once the request itself resolves (no longer "Starting…"), but the button
    // stays disabled — see the next test — because the refresh it triggered hasn't landed yet.
    await screen.findByText('Verify your pilot id')
  })

  // Pins the double-start race fix: useOwnPilotVerificationStatus holds its previous state during
  // a refetch (no intermediate 'loading'), so re-enabling the button the instant the request
  // promise resolves — before the refresh it triggered has actually landed — would let a second
  // click re-run a live flightlog.org scrape and re-send a real email. The button must stay
  // disabled until the parent actually passes a new `status` object (simulated here by rerendering
  // with one), not merely until the request settles.
  it('keeps the button disabled after the request settles, only re-enabling once a new status object lands', async () => {
    mockStartPilotVerificationAction.mockResolvedValue({ status: 'success' })

    const { rerender } = render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button'))

    await vi.waitFor(() => expect(mockStartPilotVerificationAction).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)

    // Still the same 'none' status object shape, but a genuinely new object — simulating the
    // parent's refetch landing (the hook always calls setState with a fresh literal, see its own
    // doc comment) rather than a stale re-render with the same reference.
    rerender(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)

    expect(screen.getByRole('button')).toHaveProperty('disabled', false)
  })

  it('shows the inline error message returned by the action, staying disabled until a refresh lands (send-failed still writes a pending row despite reporting an error)', async () => {
    const onStatusChanged = vi.fn()
    mockStartPilotVerificationAction.mockResolvedValue({
      status: 'error',
      message: 'Your verification code was generated, but we could not email it. Try again in a moment.',
    })

    const { rerender } = render(<PilotVerification onStatusChanged={onStatusChanged} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button'))

    await screen.findByText('Your verification code was generated, but we could not email it. Try again in a moment.')
    expect(onStatusChanged).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)

    rerender(<PilotVerification onStatusChanged={onStatusChanged} status={{ kind: 'none' }} />)
    expect(screen.getByRole('button')).toHaveProperty('disabled', false)
  })

  it('shows the started-logged info message distinctly from an error', async () => {
    mockStartPilotVerificationAction.mockResolvedValue({
      status: 'started-logged',
      message: 'Verification started. Check the server log for your code.',
    })

    render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button'))

    const info = await screen.findByText('Verification started. Check the server log for your code.')
    expect(info.className).not.toContain('text-red-600')
    expect(info.getAttribute('aria-live')).toBe('polite')
  })

  // #190: the 'none' → 'pending' transition changes PilotVerification's own root element type
  // (StartVerificationTrigger directly → a wrapping div around ConfirmPilotVerificationForm plus
  // the "Send a new code" trigger), unmounting the trigger instance that set this message. Without
  // lifting the message into PilotVerification itself, it would be discarded along with that
  // instance and the pending view would show no hint that no email was actually sent.
  it('keeps the started-logged message visible across a "none" to "pending" transition', async () => {
    mockStartPilotVerificationAction.mockResolvedValue({
      status: 'started-logged',
      message: 'Verification started. Check the server log for your code.',
    })

    const { rerender } = render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await screen.findByText('Verification started. Check the server log for your code.')

    rerender(
      <PilotVerification
        onStatusChanged={vi.fn()}
        status={{ kind: 'pending', otpExpiresAt: '2026-08-13T10:32:00.000Z', email: 'pilot@example.com' }}
      />,
    )

    expect(screen.getByText('Verification started. Check the server log for your code.')).toBeTruthy()
  })
})

describe('PilotVerification, verified', () => {
  it('renders a "Re-verify" trigger with a warning about the temporary reset (#184)', () => {
    render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'verified' }} />)
    expect(screen.getByRole('button', { name: 'Re-verify' })).toBeTruthy()
    expect(screen.getByText(/temporarily un-verifies your pilot id/)).toBeTruthy()
  })

  it('does not render the "verified" warning under the "none" status, pinning the two branches are distinct', () => {
    render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)
    expect(screen.queryByText(/temporarily un-verifies your pilot id/)).toBeNull()
  })

  // #190: 'verified' and 'none' both render StartVerificationTrigger at PilotVerification's own
  // root position, so React reuses the same instance across a transition between them rather than
  // remounting it. A stale error from a failed "Re-verify" attempt must not leak into the
  // "Verify your pilot id" render that follows it (e.g. after an unrelated pilot id relink resets
  // the row back to 'none').
  it('does not carry a stale error message from a "Re-verify" attempt into a following "none" render', async () => {
    mockStartPilotVerificationAction.mockResolvedValue({
      status: 'error',
      message: 'Something went wrong starting verification.',
    })

    const { rerender } = render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'verified' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-verify' }))

    await screen.findByText('Something went wrong starting verification.')

    rerender(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)

    expect(screen.queryByText('Something went wrong starting verification.')).toBeNull()
  })
})

describe('PilotVerification, pending', () => {
  const pendingStatus: OwnPilotVerificationStatusState = {
    kind: 'pending',
    otpExpiresAt: '2026-08-13T10:32:00.000Z',
    email: 'pilot@example.com',
  }

  it('shows the email the code was sent to and renders the confirm-code form, not the start/re-verify trigger', () => {
    render(<PilotVerification onStatusChanged={vi.fn()} status={pendingStatus} />)

    expect(screen.getByText(/pilot@example.com/)).toBeTruthy()
    expect(screen.getByLabelText('Verification code')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Verify your pilot id' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Re-verify' })).toBeNull()
  })

  // The escape hatch this branch exists for: a pending row whose code never arrived (most
  // notably startPilotVerificationAction's own 'send-failed' outcome) previously had no way out
  // short of relinking the pilot id and back. "Send a new code" reuses the same trigger the
  // 'none'/'verified' branches already use.
  it('also renders a "Send a new code" trigger, calling startPilotVerificationAction on click', async () => {
    const onStatusChanged = vi.fn()
    mockStartPilotVerificationAction.mockResolvedValue({ status: 'success' })

    render(<PilotVerification onStatusChanged={onStatusChanged} status={pendingStatus} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))

    await vi.waitFor(() => expect(mockStartPilotVerificationAction).toHaveBeenCalledTimes(1))
    expect(onStatusChanged).toHaveBeenCalledTimes(1)
  })
})
