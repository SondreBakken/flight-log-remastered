// 'success' alone used to cover every completed send, sent-via-Resend and logged-only (flag off)
// alike, so a deploy with FLIGHTLOG_VERIFICATION_EMAIL_ENABLED off told the user to check an inbox
// nothing was sent to (#183). 'started-logged' exists so the flag-off path renders its own message
// instead of the "check your email" one that only applies once a real send domain is configured.
export type StartPilotVerificationState =
  | { status: 'success' }
  | { status: 'started-logged'; message: string }
  | { status: 'error'; message: string }

// Unlike account-form-state.ts/pilot-id-form-state.ts, no single lib call produces this result —
// actions.ts assembles it itself while orchestrating #173 (scrape email) -> #174 (issue OTP) ->
// #175 (send/log) in sequence (see startPilotVerificationAction's own doc comment for why that
// orchestration stays inline in the action rather than behind its own business-logic module).
// This type exists purely so that assembly has something typed to hand to the mapper below,
// mirroring the "business result -> UI state" split those two sibling state files already use.
export type StartPilotVerificationResult =
  | { kind: 'started' }
  | { kind: 'no-linked-pilot-id' }
  | { kind: 'pilot-not-found' }
  | { kind: 'no-email' }
  // A pilot-swap TOCTOU was closed by having issue_pilot_verification report back which pilot id
  // it actually bound the verification to (20260813010000_fix_..._toctou.sql) — this is that
  // mismatch surfaced to the user: the RPC-reported bound pilot id no longer matches the pilot id
  // this action scraped an email for, because the profile got relinked mid-flight. The OTP is
  // already persisted for the NEW pilot id by the time this is detected (see actions.ts's own
  // doc comment on why), but the email is never sent, so this exists specifically so the action
  // doesn't silently report success while quietly having emailed no one.
  | { kind: 'pilot-id-changed' }
  // sendVerificationEmail resolved 'logged' (see its own doc comment): FLIGHTLOG_VERIFICATION_
  // EMAIL_ENABLED is off, so the code went to the server log, not to the pilot's inbox. Distinct
  // from 'started' (the Resend-sent path) specifically so the mapper below can avoid telling the
  // user to check an email nothing was sent to.
  | { kind: 'started-logged' }
  | { kind: 'send-failed' }
  | { kind: 'error' }

const NO_LINKED_PILOT_ID_MESSAGE = 'Link your flightlog.org pilot id first, then try verifying again.'
const PILOT_NOT_FOUND_MESSAGE = "We couldn't find that pilot on flightlog.org anymore. Check your linked pilot id."
const NO_EMAIL_MESSAGE = 'Your flightlog.org profile has no email address on file. Add one on flightlog.org and try again.'
const PILOT_ID_CHANGED_MESSAGE = 'Your linked pilot id changed while we were verifying it. Try again.'
const STARTED_LOGGED_MESSAGE = 'Verification started. Check the server log for your code.'
const SEND_FAILED_MESSAGE = 'Your verification code was generated, but we could not email it. Try again in a moment.'
const GENERIC_ERROR_MESSAGE = 'Something went wrong starting pilot id verification. Try again.'

// A pure mapping from the assembled business result to what the UI shows, same split-out-of-
// actions.ts reasoning as account-form-state.ts's own doc comment ('use server' files may only
// export async Server Functions).
export function startPilotVerificationStateFor(result: StartPilotVerificationResult): StartPilotVerificationState {
  switch (result.kind) {
    case 'started':
      return { status: 'success' }
    case 'no-linked-pilot-id':
      return { status: 'error', message: NO_LINKED_PILOT_ID_MESSAGE }
    case 'pilot-not-found':
      return { status: 'error', message: PILOT_NOT_FOUND_MESSAGE }
    case 'no-email':
      return { status: 'error', message: NO_EMAIL_MESSAGE }
    case 'pilot-id-changed':
      return { status: 'error', message: PILOT_ID_CHANGED_MESSAGE }
    case 'started-logged':
      return { status: 'started-logged', message: STARTED_LOGGED_MESSAGE }
    case 'send-failed':
      return { status: 'error', message: SEND_FAILED_MESSAGE }
    case 'error':
      return { status: 'error', message: GENERIC_ERROR_MESSAGE }
  }
}
