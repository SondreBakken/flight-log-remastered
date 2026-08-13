'use client'

import { useActionState } from 'react'
import { confirmPilotVerificationAction } from './actions'
import type { ConfirmPilotVerificationState } from './confirm-pilot-verification-state'

const initialState: ConfirmPilotVerificationState = { status: 'idle' }

// Mirrors PilotIdForm's exact shape: its own useActionState, own state file, own form. Only ever
// rendered by pilot-verification.tsx while status is 'pending' — there's nothing to confirm
// otherwise.
export function ConfirmPilotVerificationForm() {
  const [state, formAction, pending] = useActionState(confirmPilotVerificationAction, initialState)

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
