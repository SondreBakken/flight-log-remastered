'use client'

import { useState } from 'react'
import { startPilotVerificationAction } from './actions'
import { ConfirmPilotVerificationForm } from './confirm-pilot-verification-form'
import type { OwnPilotVerificationStatusState } from './use-own-pilot-verification-status'
import type { StartPilotVerificationState } from './start-pilot-verification-state'

type PilotVerificationProps = {
  status: OwnPilotVerificationStatusState
  // Bumps use-own-pilot-verification-status.ts's refreshKey in index.tsx once a start-verification
  // or a successful confirm settles — see that hook's own doc comment for why this hook has no
  // other way to learn a row was written or changed.
  onStatusChanged: () => void
}

// Result of the last startPilotVerificationAction call, regardless of which StartVerificationTrigger
// instance triggered it — see the doc comment on PilotVerification's own `message` state below for
// why this lives one level up instead of inside StartVerificationTrigger itself.
type TriggerMessage = { kind: 'error' | 'info'; text: string } | null

// Third sibling alongside AccountForm/PilotIdForm in index.tsx. Only rendered there once a pilot
// id is actually linked (see SignedInAccountForm's own doc comment) — startPilotVerificationAction
// already rejects a missing link server-side too, so this is a UX gate, not the only one.
export function PilotVerification({ status, onStatusChanged }: PilotVerificationProps) {
  // Lives here, not inside StartVerificationTrigger, so it survives that component unmounting and
  // remounting across a status.kind transition that changes PilotVerification's own root element
  // type (e.g. 'none' → 'pending': StartVerificationTrigger directly → a wrapping div, see the
  // 'pending' branch below) — otherwise a 'started-logged' message set the instant before such a
  // transition would be discarded along with the unmounted instance that held it (#190).
  const [message, setMessage] = useState<TriggerMessage>(null)

  // Same "adjust state during render" idiom as StartVerificationTrigger's own prevStatus check
  // below (see its doc comment for the pattern itself). 'none' and 'verified' both render
  // StartVerificationTrigger at that same root position, so React treats a transition between them
  // as reusing the same instance rather than remounting it — without this, a stale message from a
  // failed 'Re-verify' attempt could leak into an unrelated later 'none' render (#190), e.g. after
  // a pilot id relink resets an unrelated verification row back to 'none'. 'pending' is the only
  // kind a trigger click can ever actually produce (issue_pilot_verification is the only writer of
  // a 'pending' row), so landing on any other kind means the transition happened for a reason other
  // than what `message` describes — only a transition INTO 'pending' preserves it.
  const [prevKind, setPrevKind] = useState(status.kind)
  if (status.kind !== prevKind) {
    setPrevKind(status.kind)
    if (status.kind !== 'pending') setMessage(null)
  }

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
    return (
      <StartVerificationTrigger
        label="Verify your pilot id"
        message={message}
        onMessageChange={setMessage}
        onSettled={onStatusChanged}
        status={status}
      />
    )
  }

  if (status.kind === 'verified') {
    return (
      <StartVerificationTrigger
        label="Re-verify"
        message={message}
        onMessageChange={setMessage}
        onSettled={onStatusChanged}
        status={status}
        // Per #184's resolution: starting verification unconditionally resets an already-verified
        // profile to pending until a fresh code is confirmed. Safe (self-service, fully
        // recoverable) but surprising without this warning, since the button looks identical to
        // the first-time "Verify" trigger otherwise.
        warning="You're already verified. Starting a new verification sends a fresh code and temporarily un-verifies your pilot id until you confirm it."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm opacity-70">
          Check {status.email} for your verification code. It expires at {formatExpiry(status.otpExpiresAt)}.
        </p>
        <ConfirmPilotVerificationForm onConfirmed={onStatusChanged} />
      </div>
      {/* Escape hatch for a pending row whose code never actually arrived — most notably
          startPilotVerificationAction's own 'send-failed' outcome (a real StartPilotVerificationState
          variant), which persists a pending row for an email that was never delivered. Without this,
          that user's only way out was relinking their pilot id (which deletes the row via
          invalidate_verification_on_pilot_id_change) and relinking back. */}
      <StartVerificationTrigger
        label="Send a new code"
        message={message}
        onMessageChange={setMessage}
        onSettled={onStatusChanged}
        status={status}
      />
    </div>
  )
}

function formatExpiry(otpExpiresAt: string): string {
  return new Date(otpExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// startPilotVerificationAction takes no arguments — like followPilotAction/unfollowPilotAction
// (see follow-button/index.tsx's own handleClick), it's called directly from a click handler
// rather than bound through useActionState, which needs a form and at least one field to bind.
// Local pending state lives here, same shape as FollowButton's own useState pair — the result
// `message` itself lives one level up in PilotVerification instead, controlled through props; see
// that component's own doc comment on why.
//
// `status` is threaded through purely as a "did the refetch actually land yet" signal (see the
// render-time check below), not read for its own value here — pilot-verification.tsx's own three
// call sites already know which status they're rendering for.
function StartVerificationTrigger({
  label,
  warning,
  status,
  message,
  onMessageChange,
  onSettled,
}: {
  label: string
  warning?: string
  status: OwnPilotVerificationStatusState
  message: TriggerMessage
  onMessageChange: (message: TriggerMessage) => void
  onSettled: () => void
}) {
  // 'requesting': startPilotVerificationAction is actually in flight. 'awaiting-refresh': the
  // request has settled and the refresh it triggered is still outstanding. Both disable the
  // button; only 'requesting' changes its label — see the render-time check below for why
  // 'awaiting-refresh' exists as its own phase rather than folding straight back to 'idle'. Kept
  // local (unlike `message`) is fine: a remount always starts a fresh button the user hasn't
  // clicked yet, so there's no in-flight click to lose track of.
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'awaiting-refresh'>('idle')

  // React's "adjusting state when a prop changes" pattern
  // (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes), not
  // a useEffect: setState during render, gated on comparing `status` against what it was on the
  // previous render, rather than in a post-commit effect — this is the pattern React's own docs
  // recommend for this exact "reset local state once a prop changes" shape, and avoids both the
  // extra render pass and react-hooks/set-state-in-effect's own lint warning a useEffect version
  // would trigger here.
  //
  // useOwnPilotVerificationStatus holds its PREVIOUS state during a refetch rather than
  // transitioning through 'loading' (see that hook's own doc comment) — so without this, the
  // button would re-enable the instant the request promise resolves, well before the refresh it
  // triggered has actually landed. A user could then click again in that window and re-run a live
  // flightlog.org scrape + re-send a real email. Since the hook only ever calls setState with a
  // brand-new object (stateFromRow always returns a fresh literal), any change to `status`'s
  // identity — regardless of whether its VALUE also changed — is proof a fetch actually resolved,
  // which is exactly the signal needed to leave 'awaiting-refresh'.
  const [prevStatus, setPrevStatus] = useState(status)
  if (status !== prevStatus) {
    setPrevStatus(status)
    if (phase === 'awaiting-refresh') setPhase('idle')
  }

  async function handleClick() {
    setPhase('requesting')
    onMessageChange(null)
    const result: StartPilotVerificationState = await startPilotVerificationAction()
    // Always refresh, regardless of outcome, and hold the button disabled until that refresh
    // actually lands (via the render-time check above) for every outcome, not only success: 'error'
    // collapses several sub-cases (see start-pilot-verification-state.ts), and some of them
    // (send-failed) still persist a pending row despite reporting an error. The client can't tell
    // which sub-case from this type alone, so treating every settled outcome the same way is the
    // only choice that's safe regardless of which one actually happened.
    setPhase('awaiting-refresh')
    onSettled()
    if (result.status === 'error') {
      onMessageChange({ kind: 'error', text: result.message })
      return
    }
    if (result.status === 'started-logged') {
      onMessageChange({ kind: 'info', text: result.message })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {warning && <p className="text-sm opacity-70">{warning}</p>}
      <button
        className="self-start rounded border border-black/20 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/25"
        disabled={phase !== 'idle'}
        onClick={handleClick}
        type="button"
      >
        {phase === 'requesting' ? 'Starting…' : label}
      </button>
      {message?.kind === 'error' && (
        <p aria-live="polite" className="text-sm text-red-600 dark:text-red-400">
          {message.text}
        </p>
      )}
      {message?.kind === 'info' && (
        <p aria-live="polite" className="text-sm opacity-70">
          {message.text}
        </p>
      )}
    </div>
  )
}
