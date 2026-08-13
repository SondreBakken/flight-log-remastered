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
  // boundPilotId is issue_pilot_verification's return value (20260813010000_fix_..._toctou.sql),
  // i.e. whatever pilot id `profiles` actually said for this user AT THE MOMENT THE RPC RAN — not
  // necessarily the pilot id the caller scraped an email for. Closes a TOCTOU: the caller
  // (#176's server action) reads a pilot id, does a slow live scrape for that pilot id's email,
  // then calls this function — if the user relinks their profile to a different pilot id during
  // that scrape window, the function (which re-derives the pilot id from `profiles` itself, not
  // from anything the caller scraped for) binds the verification to the NEW pilot id while the
  // email went to the OLD pilot id's address. This module can't detect that mismatch itself (it
  // never sees the pilot id the caller scraped for, only the scraped email string), so it hands
  // boundPilotId back and leaves the comparison to the caller, which does have both values in
  // scope.
  | { kind: 'issued'; code: string; boundPilotId: number }
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

  const { data, error } = await supabase.rpc('issue_pilot_verification', {
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

  // This repo applies migrations by hand (20260813010000_fix_..._toctou.sql's own header says
  // so), so "app code shipped ahead of the migration" is a real, expected state here, not
  // hypothetical — mirrors get-flightlog-pilot-ids.ts's own 42703 branch, which guards the same
  // kind of not-yet-migrated gap. If that migration hasn't landed yet, the RPC is still the old
  // `returns void` version and `data` comes back `null`. Without this guard, `null as number`
  // would compare unequal to every real pilot id at the call site, so EVERY verification attempt
  // would silently report a pilot-id-changed mismatch, with nothing pointing at the actual cause
  // (an unapplied migration, not a real TOCTOU race) — throwing loud and naming the migration
  // turns that into a diagnosable failure instead.
  if (typeof data !== 'number') {
    throw new ProfilesQueryError(
      `issue_pilot_verification returned ${JSON.stringify(data)} instead of the bound pilot id for user ${userId} — has migration 20260813010000_fix_issue_pilot_verification_toctou.sql been applied?`,
    )
  }

  return { kind: 'issued', code, boundPilotId: data }
}
