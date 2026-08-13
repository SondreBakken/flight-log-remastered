import type { ConfirmPilotVerificationResult } from '@/lib/profiles/confirm-pilot-verification'

export type ConfirmPilotVerificationState = { status: 'idle' } | { status: 'error'; message: string } | { status: 'success' }

// Defined as an explicit superset of the lib-level result (rather than its own duplicate union) so
// the relationship between the two is visible here rather than only by naming convention.
export type ConfirmPilotVerificationOutcome =
  | ConfirmPilotVerificationResult
  // 'db-error' is a UI-layer-only outcome (not something confirmPilotVerification itself returns) —
  // the caller in actions.ts folds thrown errors into it before calling confirmPilotVerificationStateFor
  // below, e.g. a thrown ProfilesQueryError or network error, as opposed to the lib-level
  // 'locked-out'/'incorrect-or-expired' outcomes the RPC itself returns for expected business-rule
  // rejections. The same "expected rejection gets its own typed outcome, unexpected failure gets its
  // own generic one" split start-pilot-verification-state.ts draws between 'rate-limited' and its own
  // generic 'error'.
  | { kind: 'db-error' }

const INCORRECT_OR_EXPIRED_MESSAGE = 'That code is incorrect or has expired. Start verification again for a fresh code.'
const LOCKED_OUT_MESSAGE = 'Too many incorrect attempts. Start verification again for a fresh code.'
const GENERIC_ERROR_MESSAGE = 'Something went wrong confirming your pilot id verification. Try again.'

// The RPC (confirm_pilot_verification) returns a plain boolean — no distinction between "wrong
// code" and "expired code" from the RPC alone, because it folds both checks into a single UPDATE
// with no rows matched (see that function's own doc comment in
// 20260813000000_create_profile_verifications.sql). Collapsed into one combined message here
// rather than pre-empting with a client-side check of the status hook's own otpExpiresAt, for two
// reasons: (1) a client clock is not authoritative over the server's `now()` the RPC actually
// gates on — a client-side pre-check could tell a user "still valid" seconds before the server
// disagrees (clock skew, request latency), or "expired" when the server would still accept it,
// training them to trust a check the server doesn't; (2) it mirrors pilot-id-form-state.ts's own
// 'invalid-pilot-id' precedent (there, malformed vs well-formed-but-unrecognised; here, wrong vs
// expired) — collapsed because neither distinction is this app's business to guess at from a
// plain boolean, and "request a fresh code" is the same remedy either way.
export function confirmPilotVerificationStateFor(result: ConfirmPilotVerificationOutcome): ConfirmPilotVerificationState {
  switch (result.kind) {
    case 'confirmed':
      return { status: 'success' }
    case 'incorrect-or-expired':
      return { status: 'error', message: INCORRECT_OR_EXPIRED_MESSAGE }
    case 'locked-out':
      return { status: 'error', message: LOCKED_OUT_MESSAGE }
    case 'db-error':
      return { status: 'error', message: GENERIC_ERROR_MESSAGE }
  }
}
