import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { ProfilesQueryError } from './profiles-query-error'

// SQLSTATE for confirm_pilot_verification's attempt-lockout rejection (issue #189,
// 20260813040000_lockout_confirm_pilot_verification_attempts.sql). Mirrors
// issue-pilot-verification.ts's own RL001 convention: a custom code, not a bare `raise
// exception` (which would come back as this same function's own P0001-shaped `false` case
// instead), so this module can tell "locked out" apart from a plain wrong/expired guess by
// error.code alone, without parsing error.message.
const LOCKED_OUT_SQLSTATE = 'AL001'

export type ConfirmPilotVerificationResult =
  | { kind: 'confirmed' }
  // The RPC's own bare `false` — wrong code, expired code, or no pending row at all, folded into
  // one class since confirm_pilot_verification itself can't distinguish them from a single UPDATE
  // with no rows matched (see that function's own doc comment). Unchanged from before #189.
  | { kind: 'incorrect-or-expired' }
  // The row hit its failed-attempt threshold (20260813040000's own doc comment: 5 by default) —
  // every further call is rejected until a fresh code is issued, even one carrying the correct
  // code. A distinguishable outcome so the UI can tell a locked-out user to request a new code
  // rather than implying "try again" the way 'incorrect-or-expired' does.
  | { kind: 'locked-out' }

// Business logic: calls the authenticated-callable confirm_pilot_verification RPC and translates
// its boolean result / AL001 rejection into a typed outcome — same "RPC error code -> typed
// result, not a raw error surfacing to the caller" shape issue-pilot-verification.ts already
// established for its sibling RPC's RL001. Takes the caller's own session-scoped client, never an
// admin client: confirm_pilot_verification derives auth.uid() from the caller's own session
// internally, so there is no user id for this module to pass in.
export async function confirmPilotVerification(supabase: SupabaseClient, submittedCode: string): Promise<ConfirmPilotVerificationResult> {
  const { data, error } = await supabase.rpc('confirm_pilot_verification', { submitted_code: submittedCode })

  if (error) {
    if (error.code === LOCKED_OUT_SQLSTATE) return { kind: 'locked-out' }

    console.error('[profiles] failed to confirm pilot verification:', error)
    throw new ProfilesQueryError(`Failed to confirm pilot verification: ${error.message}`, { cause: error })
  }

  return data ? { kind: 'confirmed' } : { kind: 'incorrect-or-expired' }
}
