import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { ProfilesQueryError } from './profiles-query-error'
import { generateOtpCode } from './generate-otp-code'

// SQLSTATE for a bare `RAISE EXCEPTION` with no explicit ERRCODE (plpgsql's default,
// P0001/raise_exception) — what issue_pilot_verification (20260813000000_..._verifications.sql)
// raises for "no flightlog pilot id linked to the target profile". Matched by code, not by
// parsing error.message, so a future reword of that message text doesn't silently stop this
// module from recognising it.
const RAISE_EXCEPTION_SQLSTATE = 'P0001'

export type IssuePilotVerificationResult =
  | { kind: 'issued'; code: string }
  // Not a ProfilesQueryError: the target user genuinely has no flightlog_pilot_id linked yet,
  // same "expected business-rule rejection, not a query failure" distinction PilotEmailOutcome
  // draws for 'no-email'/'not-found' (get-pilot-email.ts) — the SQL function raised this on
  // purpose, nothing about the query itself failed. Collapsing it into the ProfilesQueryError
  // throw path would make #176's caller catch a generic "profiles unavailable" class to detect
  // "this specific user hasn't linked a pilot id yet", which needs its own reaction (surface a
  // "link your pilot id first" prompt, not a generic error toast).
  | { kind: 'no-linked-pilot-id' }

// Business logic: generate a plaintext OTP and persist it (hashed) via the service_role-only
// issue_pilot_verification RPC, against an injected Supabase client — same testability
// convention as get-flightlog-pilot-ids.ts and delete-comment.ts.
//
// 'server-only': this module's only legitimate caller is a trusted server context holding a
// createAdminClient() (src/lib/supabase/admin.ts) — issue_pilot_verification's own doc comment
// (supabase/migrations/20260813000000_..._verifications.sql) is explicit that only a
// service-role client may call it, since `code` being caller-supplied makes the caller itself
// part of the trust boundary. This module doesn't construct that client itself (the caller does,
// e.g. #176's server action, and passes it in), but it must never be reachable from
// client-bundle code regardless.
//
// Owns generating the code, not just persisting a caller-supplied one: the caller (#176) needs
// the plaintext code back either way (to hand to #175's sendVerificationEmail), so the only
// question is which side calls generateOtpCode(). Doing it here keeps "how the code is generated"
// and "how it's issued" as one atomic step behind one function call — a caller can't accidentally
// call issue_pilot_verification with a code that didn't come from generateOtpCode's CSPRNG (e.g.
// by hand-rolling one with Math.random() at the call site), and #176 reads as a straight line:
// `const { code } = await issuePilotVerification(...); await sendVerificationEmail(email, code)`.
export async function issuePilotVerification(
  supabase: SupabaseClient,
  userId: string,
  scrapedEmail: string,
): Promise<IssuePilotVerificationResult> {
  const code = generateOtpCode()

  const { error } = await supabase.rpc('issue_pilot_verification', {
    target_user_id: userId,
    scraped_email: scrapedEmail,
    code,
  })

  if (error) {
    if (error.code === RAISE_EXCEPTION_SQLSTATE) return { kind: 'no-linked-pilot-id' }

    console.error('[profiles] failed to issue pilot verification:', error)
    throw new ProfilesQueryError(`Failed to issue a pilot verification code for user ${userId}: ${error.message}`, {
      cause: error,
    })
  }

  return { kind: 'issued', code }
}
