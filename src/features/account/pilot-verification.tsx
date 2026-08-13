'use client'

import { useState } from 'react'
import { startPilotVerificationAction } from './actions'
import { ConfirmPilotVerificationForm } from './confirm-pilot-verification-form'
import type { OwnPilotVerificationStatusState } from './use-own-pilot-verification-status'
import type { StartPilotVerificationState } from './start-pilot-verification-state'

type PilotVerificationProps = {
  status: OwnPilotVerificationStatusState
  // Bumps use-own-pilot-verification-status.ts's refreshKey in index.tsx once a start-verification
  // call settles — see that hook's own doc comment for why this hook has no other way to learn a
  // new row was written.
  onVerificationStarted: () => void
}

// Third sibling alongside AccountForm/PilotIdForm in index.tsx. Only rendered there once a pilot
// id is actually linked (see SignedInAccountForm's own doc comment) — startPilotVerificationAction
// already rejects a missing link server-side too, so this is a UX gate, not the only one.
export function PilotVerification({ status, onVerificationStarted }: PilotVerificationProps) {
  if (status.kind === 'loading') return null

  if (status.kind === 'error') {
    // Mirrors PilotIdForm's own pilotIdLoadFailed convention: a distinct, visible failure state
    // rather than silently rendering as if there were nothing to verify — a returning user who is
    // actually 'pending' or 'verified' must never see this collapse into "nothing in flight" and
    // be invited to re-trigger.
    return (
      <p className="text-sm opacity-70">
        Couldn&apos;t load your pilot id verification status. Reload the page to try again.
      </p>
    )
  }

  if (status.kind === 'none') {
    return <StartVerificationTrigger label="Verify your pilot id" onSettled={onVerificationStarted} />
  }

  if (status.kind === 'verified') {
    return (
      <StartVerificationTrigger
        label="Re-verify"
        onSettled={onVerificationStarted}
        // Per #184's resolution: starting verification unconditionally resets an already-verified
        // profile to pending until a fresh code is confirmed. Safe (self-service, fully
        // recoverable) but surprising without this warning, since the button looks identical to
        // the first-time "Verify" trigger otherwise.
        warning="You're already verified. Starting a new verification sends a fresh code and temporarily un-verifies your pilot id until you confirm it."
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm opacity-70">
        Check {status.email} for your verification code. It expires at {formatExpiry(status.otpExpiresAt)}.
      </p>
      <ConfirmPilotVerificationForm />
    </div>
  )
}

function formatExpiry(otpExpiresAt: string): string {
  return new Date(otpExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

type LocalTriggerState = { kind: 'idle' } | { kind: 'pending' } | { kind: 'error'; message: string } | { kind: 'info'; message: string }

// startPilotVerificationAction takes no arguments — like followPilotAction/unfollowPilotAction
// (see follow-button/index.tsx's own handleClick), it's called directly from a click handler
// rather than bound through useActionState, which needs a form and at least one field to bind.
// Local pending/result state lives here instead, same shape as FollowButton's own useState pair.
function StartVerificationTrigger({ label, warning, onSettled }: { label: string; warning?: string; onSettled: () => void }) {
  const [local, setLocal] = useState<LocalTriggerState>({ kind: 'idle' })

  async function handleClick() {
    setLocal({ kind: 'pending' })
    const result: StartPilotVerificationState = await startPilotVerificationAction()
    // Always refresh, regardless of outcome: 'error' collapses several sub-cases (see
    // start-pilot-verification-state.ts), some of which (send-failed) still write a pending row
    // and some of which (no-linked-pilot-id) don't — the client can't tell which from this type
    // alone, so re-reading the actual status is the only way to stay accurate either way.
    onSettled()
    if (result.status === 'error') {
      setLocal({ kind: 'error', message: result.message })
      return
    }
    if (result.status === 'started-logged') {
      setLocal({ kind: 'info', message: result.message })
      return
    }
    setLocal({ kind: 'idle' })
  }

  return (
    <div className="flex flex-col gap-2">
      {warning && <p className="text-sm opacity-70">{warning}</p>}
      <button
        className="self-start rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
        disabled={local.kind === 'pending'}
        onClick={handleClick}
        type="button"
      >
        {local.kind === 'pending' ? 'Starting…' : label}
      </button>
      {local.kind === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{local.message}</p>}
      {local.kind === 'info' && <p className="text-sm opacity-70">{local.message}</p>}
    </div>
  )
}
