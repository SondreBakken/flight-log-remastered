// Reads process.env.FLIGHTLOG_VERIFICATION_EMAIL_ENABLED and RESEND_API_KEY, neither with a
// NEXT_PUBLIC_ prefix and therefore never in the client bundle's env shim — importing this from
// a 'use client' module would silently degrade at runtime instead of failing loud. 'server-only'
// turns that mistake into a build/dev-time error instead.
import 'server-only'

import { Resend } from 'resend'

// The narrow slice of Resend's client this module actually calls, mirroring the injected
// SupabaseClient convention (see get-flightlog-pilot-ids.ts): callers pass a real client in
// production and a fake one in tests, so a send can be asserted without a real network call.
export type VerificationEmailClient = { send: Resend['emails']['send'] }

// Placeholder until a real send domain is provisioned (#175's owner decision) — the flag-gated
// path below means this is never exercised until FLIGHTLOG_VERIFICATION_EMAIL_ENABLED is turned
// on for real.
const FROM_ADDRESS = 'Flight Log <verify@flightlog.app>'

function isVerificationEmailEnabled(): boolean {
  return Boolean(process.env.FLIGHTLOG_VERIFICATION_EMAIL_ENABLED)
}

// Constructed lazily from RESEND_API_KEY, only on the flag-on path — mirrors createAdminClient's
// lazy-read convention in src/lib/supabase/admin.ts, so an unset key never surfaces while the
// feature stays gated off.
function createResendClient(): VerificationEmailClient {
  return new Resend(process.env.RESEND_API_KEY).emails
}

// Business logic: send a pilot-verification code by email, gated behind
// FLIGHTLOG_VERIFICATION_EMAIL_ENABLED so the confirm flow (#6) stays testable in dev without a
// live Resend send domain. Off (the default): logs the code server-side instead of sending. On:
// sends via Resend and never logs the code.
export async function sendVerificationEmail(email: string, code: string, resendClient?: VerificationEmailClient): Promise<void> {
  if (!isVerificationEmailEnabled()) {
    console.log(`[email] verification code for ${email}: ${code}`)
    return
  }

  const client = resendClient ?? createResendClient()
  await client.send({
    from: FROM_ADDRESS,
    to: email,
    subject: 'Your Flight Log verification code',
    text: `Your verification code is ${code}`,
  })
}
