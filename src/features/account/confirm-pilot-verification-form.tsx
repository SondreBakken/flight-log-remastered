'use client'

import { useActionState, useEffect } from 'react'
import { confirmPilotVerificationAction } from './actions'
import type { ConfirmPilotVerificationState } from './confirm-pilot-verification-state'

const initialState: ConfirmPilotVerificationState = { status: 'idle' }

type ConfirmPilotVerificationFormProps = {
  // Called once, right after a submit resolves to 'success' — not on mount, and not again on a
  // later unrelated re-render, since the effect below only fires when `state` itself changes and
  // useActionState never re-emits the same resolved state object for two different renders.
  // pilot-verification.tsx threads this to the same refreshKey bump used after starting
  // verification: without it, a successful confirm leaves the pending view (expiry copy + this
  // same code input) on screen indefinitely, and resubmitting the same code hits the RPC's own
  // replay protection (its hash was already cleared on the first, successful call) and reports it
  // as "incorrect or expired" — true of the second submission, misleading about the first.
  onConfirmed?: () => void
}

// Mirrors PilotIdForm's exact shape: its own useActionState, own state file, own form. Only ever
// rendered by pilot-verification.tsx while status is 'pending' — there's nothing to confirm
// otherwise.
export function ConfirmPilotVerificationForm({ onConfirmed }: ConfirmPilotVerificationFormProps) {
  const [state, formAction, pending] = useActionState(confirmPilotVerificationAction, initialState)

  useEffect(() => {
    if (state.status === 'success') onConfirmed?.()
    // onConfirmed is intentionally excluded: pilot-verification.tsx passes a fresh closure on
    // every render (it captures onStatusChanged), and re-running this effect for that alone —
    // with `state` unchanged — would call onConfirmed again on every unrelated parent re-render
    // while still showing 'success', not just once when the confirm actually succeeded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm" htmlFor="pilot-verification-code">
        Verification code
        <input
          autoComplete="one-time-code"
          className="rounded border border-black/20 px-3 py-1.5 text-sm dark:border-white/25"
          id="pilot-verification-code"
          inputMode="numeric"
          name="code"
          placeholder="6-digit code"
          type="text"
        />
      </label>
      <button
        className="self-start rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
        disabled={pending}
        type="submit"
      >
        {pending ? 'Confirming…' : 'Confirm'}
      </button>
      <p aria-live="polite" className="text-sm text-red-600 dark:text-red-400">
        {state.status === 'error' && state.message}
      </p>
      <p aria-live="polite" className="text-sm opacity-70">
        {state.status === 'success' && 'Verified.'}
      </p>
    </form>
  )
}
