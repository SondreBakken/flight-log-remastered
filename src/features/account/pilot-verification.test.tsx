import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
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

    const errorMessage = await screen.findByText(
      'Your verification code was generated, but we could not email it. Try again in a moment.',
    )
    expect(errorMessage.className).toContain('text-red-600')
    expect(onStatusChanged).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)

    // send-failed still writes a pending row despite reporting an error (this test's own title) —
    // the refresh this triggered actually lands on 'pending', not back on 'none'. This is the case
    // the server-error emission site's `survivesLandingOnPending: true` exists for, and nothing
    // pinned it before — flipping that field to `false` at the emission site must turn this
    // assertion red.
    rerender(
      <PilotVerification
        onStatusChanged={onStatusChanged}
        status={{ kind: 'pending', otpExpiresAt: '2026-08-13T10:32:00.000Z', email: 'pilot@example.com' }}
      />,
    )

    expect(
      screen.getByText('Your verification code was generated, but we could not email it. Try again in a moment.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send a new code' })).toHaveProperty('disabled', false)
  })

  // #208: unlike a server-reported 'error' result (above), a rejected request has no
  // server-provided message, so this must show immediately (not wait out the 15s timeout). A
  // rejection doesn't prove nothing happened server-side either: it can mean an ordinary transport
  // failure, or getPilotEmail throwing an uncaught Error on unrecognized flightlog.org markup that
  // actions.ts's outer catch doesn't convert to a typed result (see the catch block's own doc
  // comment in pilot-verification.tsx) — either way, consistent with the timeout and 'error' paths,
  // this must still call onStatusChanged to give a refresh a chance to discover it.
  it('shows an immediate inline error on a rejected request, without waiting for the timeout', async () => {
    const onStatusChanged = vi.fn()
    mockStartPilotVerificationAction.mockRejectedValueOnce(new Error('network failure'))

    render(<PilotVerification onStatusChanged={onStatusChanged} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await screen.findByText('Something went wrong. Try again.')
    expect(screen.getByRole('button', { name: 'Verify your pilot id' })).toHaveProperty('disabled', false)
    expect(onStatusChanged).toHaveBeenCalledTimes(1)
  })

  // #208 round 3, scenario 1: the retry-refresh a rejected request triggers can land on a
  // just-discovered 'pending' row. A `status.kind`-keyed clearing rule would have let this
  // catch-block error survive that transition (it shared the 'error' kind with the
  // server-reported, legitimately-surviving branch), leaving "Something went wrong. Try again."
  // sitting right next to the now-enabled "Send a new code" button and inviting a destructive
  // resend of a code that may already have gone out.
  it('clears a rejected-request error message once the refresh it triggered discovers a pending row, instead of leaving it beside the enabled resend button', async () => {
    const onStatusChanged = vi.fn()
    mockStartPilotVerificationAction.mockRejectedValueOnce(new Error('network failure'))

    const { rerender } = render(<PilotVerification onStatusChanged={onStatusChanged} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await screen.findByText('Something went wrong. Try again.')

    rerender(
      <PilotVerification
        onStatusChanged={onStatusChanged}
        status={{ kind: 'pending', otpExpiresAt: '2026-08-13T10:32:00.000Z', email: 'pilot@example.com' }}
      />,
    )

    expect(screen.queryByText('Something went wrong. Try again.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send a new code' })).toHaveProperty('disabled', false)
  })

  // #208 round 5: a refresh landing back on the SAME kind the message was shown under ('none' →
  // 'none') means nothing was written — no pending row exists, so there's no hazard to guard
  // against, and the message ("try again") is exactly the explanation the now-re-enabled button
  // needs next. This is distinct from the case right above (a refresh discovering a NEW kind,
  // 'pending'): here `status.kind` never changes at all, so even a `survivesLandingOnPending: false`
  // message (this attempt's outcome is genuinely unknown, see the catch block's own doc comment)
  // must stay visible — same-kind is never itself a reason to clear.
  it('keeps a non-surviving message visible when a refresh lands back on the same kind it was shown under', async () => {
    const onStatusChanged = vi.fn()
    mockStartPilotVerificationAction.mockRejectedValueOnce(new Error('network failure'))

    const { rerender } = render(<PilotVerification onStatusChanged={onStatusChanged} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await screen.findByText('Something went wrong. Try again.')

    rerender(<PilotVerification onStatusChanged={onStatusChanged} status={{ kind: 'none' }} />)

    expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Verify your pilot id' })).toHaveProperty('disabled', false)
  })

  // handleClick's onMessageChange(null) at the top, clearing any message left over from a prior
  // attempt the instant a new one starts (rather than leaving stale text on screen for the
  // duration of the new request) — deleting that line leaves every other test in this file green.
  it('clears a previous error message the instant a new attempt starts, before the new request settles', async () => {
    mockStartPilotVerificationAction.mockResolvedValueOnce({
      status: 'error',
      message: 'Something went wrong starting verification.',
    })

    const { rerender } = render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))
    await screen.findByText('Something went wrong starting verification.')

    // Re-enable the button, simulating the refresh the first attempt triggered having landed.
    rerender(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)

    let resolveSecond!: (result: { status: 'success' }) => void
    mockStartPilotVerificationAction.mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)))
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    expect(screen.queryByText('Something went wrong starting verification.')).toBeNull()

    resolveSecond({ status: 'success' })
  })

  it('shows the started-logged info message distinctly from an error', async () => {
    mockStartPilotVerificationAction.mockResolvedValue({
      status: 'started-logged',
      message: 'Verification started. Check the server log for your code.',
    })

    render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button'))

    const info = await screen.findByText('Verification started. Check the server log for your code.')
    // Pins the 'info' kind's own styling, not just "isn't styled as an error" — proves the
    // dedicated render branch (distinct from both 'error' and 'timeout') is actually reachable.
    expect(info.className).toContain('opacity-70')
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

describe('PilotVerification, start-verification timeout (#208)', () => {
  // Scoped to just this describe block, not global (see the repo's other fake-timer usage in
  // browse-pilot-statistics/index.test.tsx, which uses this same describe-scoped beforeEach
  // pattern, just applied to a describe wrapping that entire file rather than a subset) — every
  // other test in this file relies on real setTimeout/microtask timing via findBy/waitFor and
  // never touches fake timers, including the #190 "none to pending" test right above, so scoping
  // this to just the #208 tests below leaves the rest of the file unaffected.
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // #208: startPilotVerificationAction has no cancellation mechanism, so a hung request (network
  // stall, stuck server action) previously left the button disabled ("Starting…") forever — the
  // exact shape the #206 tests further below pin deliberately, by never advancing time past their
  // own never-resolving promise. This proves the bounded timeout actually fires and hands the user
  // back a clickable button instead of leaving it disabled forever.
  it('re-enables the button with an explanatory message after 15s of no response', async () => {
    const onStatusChanged = vi.fn()
    mockStartPilotVerificationAction.mockReturnValue(new Promise(() => {}))

    render(<PilotVerification onStatusChanged={onStatusChanged} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)

    // Pins START_VERIFICATION_TIMEOUT_MS from below, not just above: without this intermediate
    // assertion, lowering the constant (e.g. to 1ms) would still leave this test green, since only
    // the end state after a full 15s was ever checked.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999)
    })
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
    expect(screen.queryByText('This is taking longer than expected. You can try again.')).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(screen.getByRole('button', { name: 'Verify your pilot id' })).toHaveProperty('disabled', false)
    const timeoutMessage = screen.getByText('This is taking longer than expected. You can try again.')
    expect(timeoutMessage.className).not.toContain('text-red-600')
    // Pins the 'timeout' kind's own styling, not just "isn't styled as an error" — proves the
    // dedicated render branch (distinct from both 'error' and 'info') is actually reachable.
    expect(timeoutMessage.className).toContain('text-amber-600')
    // #208: the timeout must still trigger a refresh — the underlying request may have actually
    // succeeded, just slowly, and without this the user would be stuck looking at "try again"
    // while a valid code already sits in their inbox.
    expect(onStatusChanged).toHaveBeenCalledTimes(1)
  })

  // #208: a settled (not hung) request must clear its own timeout — otherwise a merely-slow but
  // ultimately fast-enough request would still get hit by the 15s timeout later, showing a
  // misleading "taking longer than expected" message for a request that already finished fine.
  it('clears the timeout once the request settles normally, so it never fires even after 15s pass', async () => {
    let resolveAction!: (result: { status: 'success' }) => void
    mockStartPilotVerificationAction.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)))

    render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await act(async () => {
      resolveAction({ status: 'success' })
      await Promise.resolve()
    })
    expect(screen.getByText('Verify your pilot id')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(screen.queryByText('This is taking longer than expected. You can try again.')).toBeNull()
  })

  // #208: a rejected request must also clear its own timeout (the finally block), not just the
  // success path — otherwise the timeout would still fire 15s later and clobber the immediate
  // error message with a stale, misleading "taking longer than expected".
  it('clears the timeout on a rejection too, so it never fires afterwards and overwrites the error', async () => {
    mockStartPilotVerificationAction.mockRejectedValueOnce(new Error('network failure'))

    render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(screen.queryByText('This is taking longer than expected. You can try again.')).toBeNull()
    expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy()
  })

  // The original request wasn't actually stuck forever, just slower than the timeout — its result
  // arrives after the timeout already gave up on it. Must not throw, and must not overwrite the
  // timeout message/re-enabled button the user is already looking at with a stale 'success'.
  it('ignores a late resolution of the original request after its own timeout already fired', async () => {
    const onStatusChanged = vi.fn()
    let resolveAction!: (result: { status: 'success' }) => void
    mockStartPilotVerificationAction.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)))

    render(<PilotVerification onStatusChanged={onStatusChanged} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.getByText('This is taking longer than expected. You can try again.')).toBeTruthy()
    expect(onStatusChanged).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveAction({ status: 'success' })
      await Promise.resolve()
    })

    expect(screen.getByText('This is taking longer than expected. You can try again.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Verify your pilot id' })).toHaveProperty('disabled', false)
    // #208: the late-arriving real result triggers its own, second refresh — more time has passed
    // since the timeout's own refresh, so this one has a better chance of actually seeing the
    // pending row land.
    expect(onStatusChanged).toHaveBeenCalledTimes(2)
  })

  // The other half of the same guard: the user actually did click again after the timeout
  // re-enabled the button, starting a second, distinct request. The first (abandoned) request
  // resolving afterwards must not clobber that second request's still-in-flight state. This falls
  // out of `timedOut` being a plain variable scoped to each handleClick call, not a cross-call
  // requestId comparison: the first request's own closure has timedOut = true and returns early,
  // while the second request's own closure has its own, independent timedOut = false.
  it('keeps a second click in its own in-flight state when the first, abandoned request resolves late', async () => {
    let resolveFirst!: (result: { status: 'success' }) => void
    mockStartPilotVerificationAction.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))

    render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.getByText('This is taking longer than expected. You can try again.')).toBeTruthy()

    mockStartPilotVerificationAction.mockReturnValueOnce(new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    expect(screen.queryByText('This is taking longer than expected. You can try again.')).toBeNull()
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)

    await act(async () => {
      resolveFirst({ status: 'success' })
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: 'Starting…' })).toHaveProperty('disabled', true)
  })

  // The catch block's twin to "ignores a late resolution..." above, but for a rejection instead
  // of a resolution: the original request rejects after its own timeout already fired and already
  // called onSettled() once. The `if (timedOut)` guard in the catch block must stop it from
  // touching phase/message for this same, already-accounted-for click — but (#208 round 3) it
  // still refreshes a second time, symmetrically with the late-resolve case above: more time has
  // passed since the timeout's own refresh, so this one has a better chance of actually seeing a
  // pending row land.
  it('ignores a late rejection of the original request after its own timeout already fired, but still refreshes again', async () => {
    const onStatusChanged = vi.fn()
    let rejectAction!: (error: Error) => void
    mockStartPilotVerificationAction.mockReturnValue(new Promise((_resolve, reject) => (rejectAction = reject)))

    render(<PilotVerification onStatusChanged={onStatusChanged} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.getByText('This is taking longer than expected. You can try again.')).toBeTruthy()
    expect(onStatusChanged).toHaveBeenCalledTimes(1)

    await act(async () => {
      rejectAction(new Error('network failure'))
      await Promise.resolve()
    })

    expect(screen.getByText('This is taking longer than expected. You can try again.')).toBeTruthy()
    expect(screen.queryByText('Something went wrong. Try again.')).toBeNull()
    expect(onStatusChanged).toHaveBeenCalledTimes(2)
  })

  // A 'timeout' message's truth ("still waiting on this") expires the moment the request it
  // warned about turns out to have actually resolved into a 'pending' row — unlike the
  // 'started-logged' message (#190, pinned in the 'none' describe block above), which stays true
  // once pending. Without this, the stale "try again" warning would sit next to the real
  // verification code UI and invite a destructive resend.
  it('clears the timeout message once the status transitions to pending, since the request it warned about may have actually landed', async () => {
    const onStatusChanged = vi.fn()
    mockStartPilotVerificationAction.mockReturnValue(new Promise(() => {}))

    const { rerender } = render(<PilotVerification onStatusChanged={onStatusChanged} status={{ kind: 'none' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify your pilot id' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.getByText('This is taking longer than expected. You can try again.')).toBeTruthy()

    rerender(
      <PilotVerification
        onStatusChanged={onStatusChanged}
        status={{ kind: 'pending', otpExpiresAt: '2026-08-13T10:32:00.000Z', email: 'pilot@example.com' }}
      />,
    )

    expect(screen.queryByText('This is taking longer than expected. You can try again.')).toBeNull()
  })

  // #208 round 3, scenario 2: this reproduces the case round 2's own fix missed. The trigger here
  // is the one rendered INSIDE the already-'pending' view (the "Send a new code" escape hatch),
  // and its own timeout-triggered refresh discovers a fresh pending row — status.kind stays
  // 'pending' throughout, so a `status.kind`-CHANGE-keyed clearing rule would never even run.
  it('clears a stale timeout message from the pending-view "Send a new code" trigger once a refresh lands a fresh pending row, even though status.kind never changes', async () => {
    const onStatusChanged = vi.fn()
    mockStartPilotVerificationAction.mockReturnValue(new Promise(() => {}))

    const { rerender } = render(
      <PilotVerification
        onStatusChanged={onStatusChanged}
        status={{ kind: 'pending', otpExpiresAt: '2026-08-13T10:32:00.000Z', email: 'pilot@example.com' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.getByText('This is taking longer than expected. You can try again.')).toBeTruthy()

    // A fresh pending row (new otpExpiresAt) landed — a genuinely new status object, same kind.
    rerender(
      <PilotVerification
        onStatusChanged={onStatusChanged}
        status={{ kind: 'pending', otpExpiresAt: '2026-08-13T11:00:00.000Z', email: 'pilot@example.com' }}
      />,
    )

    expect(screen.queryByText('This is taking longer than expected. You can try again.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send a new code' })).toHaveProperty('disabled', false)
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

  // #206: pins the lifted `phase` wiring on this specific call site. Per #184, starting
  // verification on an already-verified profile downgrades it to 'pending' — a double-fire here
  // would cost a live flightlog.org scrape, a real email send, AND an unwanted loss of verified
  // status, so this is the highest-consequence of the three StartVerificationTrigger call sites.
  it('disables the "Re-verify" trigger while its request is in flight', () => {
    mockStartPilotVerificationAction.mockReturnValue(new Promise(() => {}))

    render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'verified' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-verify' }))

    expect(screen.getByRole('button', { name: 'Starting…' })).toHaveProperty('disabled', true)
  })

  // #208: a `survivesLandingOnPending: true` message must survive a refresh that lands on the SAME
  // kind it was already describing ('verified' → 'verified'), not just a change into 'pending'
  // (#190, pinned in the 'none' describe block above) — that refresh is the message's OWN click
  // confirming it, not a contradicting transition.
  it('keeps a survivesLandingOnPending message visible across a refresh that lands back on the same kind it was shown under', async () => {
    mockStartPilotVerificationAction.mockResolvedValue({
      status: 'error',
      message: 'Please wait a bit before requesting another code.',
    })

    const { rerender } = render(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'verified' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-verify' }))

    await screen.findByText('Please wait a bit before requesting another code.')

    rerender(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'verified' }} />)

    expect(screen.getByText('Please wait a bit before requesting another code.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Re-verify' })).toHaveProperty('disabled', false)
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

  // #206: a 'pending' → 'none' transition changes PilotVerification's own root element type (a
  // wrapping div around ConfirmPilotVerificationForm plus the "Send a new code" trigger → the
  // "Verify your pilot id" trigger directly), unmounting the "Send a new code"
  // StartVerificationTrigger instance and mounting a fresh one. Reachable when a sibling
  // PilotIdForm save lands mid-flight: the DB trigger deletes the profile_verifications row,
  // flipping status to 'none' while the original startPilotVerificationAction call is still
  // outstanding. Without lifting `phase` into PilotVerification, the fresh instance starts at
  // 'idle' and hands the user a clickable button while the original request (a live
  // flightlog.org scrape + real email send) is still in flight.
  it('keeps the trigger disabled across a "pending" to "none" transition while the original request is still in flight', async () => {
    mockStartPilotVerificationAction.mockReturnValue(new Promise(() => {}))

    const { rerender } = render(<PilotVerification onStatusChanged={vi.fn()} status={pendingStatus} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))

    expect(screen.getByRole('button', { name: 'Starting…' })).toHaveProperty('disabled', true)

    rerender(<PilotVerification onStatusChanged={vi.fn()} status={{ kind: 'none' }} />)

    // Still the same lifted `phase`, so the remounted instance (rendering the "Verify your pilot
    // id" trigger's position) still shows "Starting…" rather than resetting to an enabled, fresh
    // "Verify your pilot id" button — a local phase would have reset to 'idle' here instead.
    expect(screen.getByRole('button')).toHaveProperty('disabled', true)
    expect(screen.getByText('Starting…')).toBeTruthy()
  })

  // #208 round 3, scenario 3: the rejection twin of the timeout case above. A rejected "Send a new
  // code" attempt, fired from inside the already-'pending' view, triggers a refresh that discovers
  // a fresh pending row — status.kind stays 'pending' throughout, so this only clears correctly
  // once the clearing rule fires on ANY fresh status object, not just a status.kind change.
  it('clears a rejected-request error message from the pending-view "Send a new code" trigger once a refresh lands a fresh pending row, even though status.kind never changes', async () => {
    const onStatusChanged = vi.fn()
    mockStartPilotVerificationAction.mockRejectedValueOnce(new Error('network failure'))

    const { rerender } = render(<PilotVerification onStatusChanged={onStatusChanged} status={pendingStatus} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))

    await screen.findByText('Something went wrong. Try again.')

    rerender(
      <PilotVerification
        onStatusChanged={onStatusChanged}
        status={{ kind: 'pending', otpExpiresAt: '2026-08-13T11:00:00.000Z', email: 'pilot@example.com' }}
      />,
    )

    expect(screen.queryByText('Something went wrong. Try again.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send a new code' })).toHaveProperty('disabled', false)
  })
})
