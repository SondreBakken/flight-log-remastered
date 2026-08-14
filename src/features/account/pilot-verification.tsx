'use client'

import { useState } from 'react'
import { startPilotVerificationAction } from './actions'
import { ConfirmPilotVerificationForm } from './confirm-pilot-verification-form'
import type { OwnPilotVerificationStatusState } from './use-own-pilot-verification-status'
import type { StartPilotVerificationState } from './start-pilot-verification-state'

// #208: startPilotVerificationAction has no cancellation mechanism (it's a plain server action
// call, not backed by an AbortController-aware fetch), so there's no way to actually give up on a
// hung request — only to stop waiting for it. 15s is long enough to cover a real flightlog.org
// scrape + email send under normal latency, short enough that a genuinely stuck request doesn't
// leave the button disabled indefinitely.
const START_VERIFICATION_TIMEOUT_MS = 15_000
const START_VERIFICATION_TIMEOUT_MESSAGE = 'This is taking longer than expected. You can try again.'

type PilotVerificationProps = {
  status: OwnPilotVerificationStatusState
  // Bumps use-own-pilot-verification-status.ts's refreshKey in index.tsx once a start-verification
  // or a successful confirm settles — see that hook's own doc comment for why this hook has no
  // other way to learn a row was written or changed.
  onStatusChanged: () => void
}

// Result of the last startPilotVerificationAction call, regardless of which StartVerificationTrigger
// instance triggered it — see the doc comment on PilotVerification's own `message` state below for
// why this lives one level up instead of inside StartVerificationTrigger itself. 'timeout' (#208)
// is neither a server-reported 'error' nor 'info': the request is still technically outstanding,
// just no longer worth waiting on, so it renders distinctly from both.
//
// `kind` answers "what does this text mean"; `survivesLandingOnPending` answers "does it stay true
// once a pending row exists" — independent questions, so lifetime is declared explicitly at each
// construction site (see StartVerificationTrigger's handleClick) rather than inferred from `kind`.
// TypeScript rejects any `TriggerMessage` object literal missing the field, so a new message kind
// can't silently inherit whatever rule was last written for a kind it happens to share.
type TriggerMessage = { kind: 'error' | 'info' | 'timeout'; text: string; survivesLandingOnPending: boolean } | null

// Differ only by color — kept as one lookup instead of three near-identical JSX render blocks,
// since aria-live and text size are otherwise identical across kinds. Keyed on `kind`, not
// `survivesLandingOnPending`: display styling and lifetime are the two independent concerns
// TriggerMessage keeps apart, and a message's color doesn't depend on how long it stays visible.
const MESSAGE_TEXT_STYLES: Record<NonNullable<TriggerMessage>['kind'], string> = {
  error: 'text-red-600 dark:text-red-400',
  info: 'opacity-70',
  timeout: 'text-amber-600 dark:text-amber-400',
}

// 'requesting': startPilotVerificationAction is actually in flight. 'awaiting-refresh': the request
// has settled and the refresh it triggered is still outstanding. See PilotVerification's own
// `phase` state below for why this lives one level up instead of inside StartVerificationTrigger.
type TriggerPhase = 'idle' | 'requesting' | 'awaiting-refresh'

// Third sibling alongside AccountForm/PilotIdForm in index.tsx. Only rendered there once a pilot
// id is actually linked (see SignedInAccountForm's own doc comment) — startPilotVerificationAction
// already rejects a missing link server-side too, so this is a UX gate, not the only one.
export function PilotVerification({ status, onStatusChanged }: PilotVerificationProps) {
  // Lives here, not inside StartVerificationTrigger, so it survives that component unmounting and
  // remounting across a status.kind transition that changes PilotVerification's own root element
  // type (e.g. 'none' → 'pending': StartVerificationTrigger directly → a wrapping div, see the
  // 'pending' branch below) — otherwise a 'started-logged' message set the instant before such a
  // transition would be discarded along with the unmounted instance that held it (#190).
  //
  // How long a message set here stays visible is decided at the moment it's constructed, via its
  // own `survivesLandingOnPending` field (see TriggerMessage's own doc comment for why) — the
  // clearing rule in the `prevStatus` check below just reads that field, it doesn't infer anything
  // from `kind`.
  const [message, setMessage] = useState<TriggerMessage>(null)

  // 'requesting': startPilotVerificationAction is actually in flight. 'awaiting-refresh': the
  // request has settled and the refresh it triggered is still outstanding. Both disable the
  // button; only 'requesting' changes its label — see StartVerificationTrigger's own render for
  // that. Lives here, not inside StartVerificationTrigger, for the same reason `message` does
  // above: the 'pending' branch below renders StartVerificationTrigger inside a wrapping div while
  // 'none'/'verified' render it directly at the root, so a transition into or out of 'pending'
  // remounts the instance — a local phase would reset to 'idle' on that remount and re-enable a
  // button whose underlying request is still in flight (#206).
  const [phase, setPhase] = useState<TriggerPhase>('idle')

  // React's "adjusting state when a prop changes" pattern
  // (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes), not
  // a useEffect: setState during render, gated on comparing `status` against what it was on the
  // previous render, rather than in a post-commit effect — this is the pattern React's own docs
  // recommend for this exact "reset local state once a prop changes" shape, and avoids both the
  // extra render pass and react-hooks/set-state-in-effect's own lint warning a useEffect version
  // would trigger here.
  //
  // useOwnPilotVerificationStatus holds its PREVIOUS state during a refetch rather than
  // transitioning through 'loading' (see that hook's own doc comment) — so without this, stale
  // local state would linger the instant the request promise resolves, well before the refresh it
  // triggered has actually landed. Since the hook only ever calls setState with a brand-new object
  // (stateFromRow always returns a fresh literal), any change to `status`'s identity — regardless
  // of whether its VALUE also changed — is proof a fetch actually resolved, which is exactly the
  // signal needed to know a refresh actually landed. Two independent things key off that same
  // signal below:
  //
  // Both phase-reset and message-clearing key off this same fresh-identity signal, not a narrower
  // status.kind-only comparison: the "Send a new code" trigger inside the already-'pending' view
  // can refresh into a NEW pending row (a fresh otpExpiresAt) without status.kind ever changing, and
  // a message describing that attempt still needs to clear or persist correctly in that case too.
  const [prevStatus, setPrevStatus] = useState(status)
  if (status !== prevStatus) {
    const prevKind = prevStatus.kind
    setPrevStatus(status)

    // A button whose underlying request is still in flight must not re-enable just because the
    // request PROMISE resolved — see the block comment above for why a fresh `status` identity,
    // not merely the promise settling, is the actual signal that a refresh landed. A user could
    // otherwise click again in that window and re-run a live flightlog.org scrape + re-send a real
    // email (#206).
    if (phase === 'awaiting-refresh') setPhase('idle')

    // `landedOnUnrelatedKind` catches a transition the message wasn't about at all (e.g. a pilot id
    // relink resetting an unrelated verification row back to 'none' while a 'verified'-view message
    // was showing, #190) and clears unconditionally, regardless of `survivesLandingOnPending`.
    // Otherwise, only clear when this refresh specifically landed on 'pending' — the only kind a
    // trigger click can ever actually produce — and the message wasn't declared to survive that. A
    // refresh landing back on the SAME kind the message was already describing (e.g. 'none' →
    // 'none', 'verified' → 'verified') is that message's own click confirming it, not a hazard: no
    // pending row exists, so there's nothing to guard against, and the message is exactly the
    // explanation the now-re-enabled button needs next — it must survive regardless of
    // `survivesLandingOnPending`.
    const landedOnUnrelatedKind = status.kind !== 'pending' && status.kind !== prevKind
    if (landedOnUnrelatedKind || (status.kind === 'pending' && !message?.survivesLandingOnPending)) setMessage(null)
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
        onPhaseChange={setPhase}
        onSettled={onStatusChanged}
        phase={phase}
      />
    )
  }

  if (status.kind === 'verified') {
    return (
      <StartVerificationTrigger
        label="Re-verify"
        message={message}
        onMessageChange={setMessage}
        onPhaseChange={setPhase}
        onSettled={onStatusChanged}
        phase={phase}
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
        onPhaseChange={setPhase}
        onSettled={onStatusChanged}
        phase={phase}
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
// Both `message` and `phase` live one level up in PilotVerification instead, controlled through
// props; see that component's own doc comments on why.
function StartVerificationTrigger({
  label,
  warning,
  message,
  onMessageChange,
  onSettled,
  phase,
  onPhaseChange,
}: {
  label: string
  warning?: string
  message: TriggerMessage
  onMessageChange: (message: TriggerMessage) => void
  onSettled: () => void
  phase: TriggerPhase
  onPhaseChange: (phase: TriggerPhase) => void
}) {
  async function handleClick() {
    onPhaseChange('requesting')
    onMessageChange(null)

    // Bounded timeout, not an abort: startPilotVerificationAction has no cancellation mechanism
    // (see the constant's own doc comment), so this only ever stops the UI from waiting — the
    // underlying request keeps running and may still settle later, handled below. A plain
    // closure boolean is enough here (no ref needed): a second click can only happen once `phase`
    // is back to 'idle', which only happens via this callback (the timeout branch), the normal
    // settle path below, or the catch block — all three routes set phase back to 'idle', and by
    // the time a second click is possible, this request has already been accounted for by one of
    // them, so there's nothing left for a request-id guard to protect against.
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      // Knowingly reopens the double-start hazard #206's lifted-phase mechanism exists to
      // prevent (see PilotVerification's own doc comment above, "re-run a live flightlog.org
      // scrape"): re-enabling the button here lets a second click start a fresh request while
      // this one may still be outstanding underneath. Accepted deliberately — a button that stays
      // disabled forever on a merely-slow request is judged worse than that risk.
      onPhaseChange('idle')
      // Does not survive landing on 'pending': the request this warned about may turn out to have
      // actually finished (see onSettled() right below), and once pending, "still waiting" is no
      // longer true — a stale "try again" sitting next to a real code would invite a destructive
      // resend.
      onMessageChange({ kind: 'timeout', text: START_VERIFICATION_TIMEOUT_MESSAGE, survivesLandingOnPending: false })
      // The request may still complete after we've stopped waiting on it (e.g. it wrote the
      // pending row and sent the email, just slowly) — refresh now so PilotVerification can pick
      // that up instead of leaving the user staring at "try again" while a valid code already
      // sits in their inbox.
      onSettled()
    }, START_VERIFICATION_TIMEOUT_MS)

    try {
      const result: StartPilotVerificationState = await startPilotVerificationAction()

      if (timedOut) {
        // This request's own timeout already re-enabled the button and refreshed once above —
        // refresh again now that the actual result has landed, in case more time passing made a
        // pending row visible that the first refresh (fired the instant the timeout expired)
        // couldn't have seen yet. Must not touch phase/message: the user may already be looking
        // at a fresh click's 'requesting' state, which this stale settlement must not clobber.
        onSettled()
        return
      }

      // Always refresh, regardless of outcome, and hold the button disabled until that refresh
      // actually lands (via PilotVerification's own render-time check) for every outcome, not only
      // success: 'error' collapses several sub-cases (see start-pilot-verification-state.ts), and
      // some of them (send-failed) still persist a pending row despite reporting an error. The
      // client can't tell which sub-case from this type alone, so treating every settled outcome
      // the same way is the only choice that's safe regardless of which one actually happened.
      onPhaseChange('awaiting-refresh')
      onSettled()
      if (result.status === 'error') {
        // Survives landing on 'pending': this branch only ever runs once the server has actually
        // returned a definitive, confirmed outcome (unlike the catch block below, which fires on an
        // inconclusive client-side failure). It collapses several distinct sub-cases (see
        // start-pilot-verification-state.ts) this type alone can't tell apart, but at least two of
        // them stay meaningfully true even once a pending row exists — 'send-failed' ("we couldn't
        // email your code") and 'rate-limited' ("wait before requesting another", often exactly why
        // a pending row is already there) — so defaulting this whole branch to survive is the safer
        // read of "the server told us something real and confirmed" than defaulting it to clear.
        onMessageChange({ kind: 'error', text: result.message, survivesLandingOnPending: true })
        return
      }
      if (result.status === 'started-logged') {
        // Survives landing on 'pending' (#190): describes what's now true about the pending state
        // itself ("check the server log for your code"), not a fact about the attempt that produced
        // it — still accurate once pending, unlike the messages below.
        onMessageChange({ kind: 'info', text: result.message, survivesLandingOnPending: true })
      }
    } catch {
      // A rejection does NOT prove nothing happened server-side, but it doesn't prove anything did
      // either. Two distinct causes are actually reachable here: an ordinary transport-level
      // failure (the response never arrived, even though the server call itself may have
      // completed) — and getPilotEmail throwing a plain, uncaught Error on unrecognized
      // flightlog.org markup (src/lib/flightlog/get-pilot-email.ts), which is NOT one of the typed
      // outcomes actions.ts's startPilotVerificationAction converts: its outer catch only catches
      // ProfilesQueryError specifically and rethrows everything else, so this reaches the client as
      // the same rejection. Either way the actual outcome is genuinely unknown, so, consistent with
      // the timeout path above, refresh anyway in case the work landed despite the client never
      // hearing back.
      //
      // Unlike the paths above, this message does NOT survive landing on 'pending': it's a generic
      // "something went wrong" about one specific attempt whose actual outcome is unknown, and once
      // a refresh lands — revealing a pending row or not — leaving that stale claim next to a live
      // retry/resend button is exactly the hazard being fixed here. Err toward clearing.
      //
      // Symmetric with the late-resolve branch above, for the same reason: if this request already
      // timed out, its timeout branch already called onSettled() once for this same click, but
      // more time has passed since then, so a second refresh has a better chance of actually
      // seeing a pending row land — refresh again, but don't touch phase/message, since the user
      // may already be looking at a fresh click's own 'requesting' state that this stale
      // settlement must not clobber.
      if (timedOut) {
        onSettled()
        return
      }
      onPhaseChange('idle')
      onMessageChange({ kind: 'error', text: 'Something went wrong. Try again.', survivesLandingOnPending: false })
      onSettled()
    } finally {
      clearTimeout(timeoutId)
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
      {message && (
        <p aria-live="polite" className={`text-sm ${MESSAGE_TEXT_STYLES[message.kind]}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
