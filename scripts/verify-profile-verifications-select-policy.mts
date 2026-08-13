import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkProfileVerificationsTableExists } from './lib/check-profile-verifications-table'
import { createReporter } from './lib/verify-report'
import { createAdminClient } from '../src/lib/supabase/admin'
import { requireSupabaseEnv } from '../src/lib/supabase/env'

// Proves supabase/migrations/20260813000000_create_profile_verifications.sql's owner-only RLS
// is actually enforced on the live project, the way verify-follows-select-policy.mts proves the
// follows SELECT policy — against a REAL authenticated Supabase session, not a stubbed client.
// Pure Node script, no browser: the thing under test is a PostgREST-level RLS policy. See that
// script's own header comment for why persistSession: false is what makes @supabase/auth-js hold
// the session in memory rather than reaching for browser storage.
//
// profile_verifications' 3 policies (see the migration) are ALL owner-scoped on user_id, in
// every direction — unlike profiles or comments, nothing about this table is ever publicly
// readable, because a live one-time code is exactly what this table exists to keep private. Two
// fixture identities pin both directions:
//   1. owner: can read AND update their own row (proves the SELECT and UPDATE policies actually
//      grant what they're supposed to — this is also the app's real upsert path).
//   2. other: authenticated, but NOT the owner — reading or updating the owner's row must not
//      leak or mutate anything. RLS filters silently rather than erroring (same as
//      verify-follows-select-policy.mts's mis-scope-guard assertion), so both checks are
//      "0 rows affected", not "request errored".
//
// Two dedicated fixture identities, distinct from every other verify-*.mts script's emails, per
// that script's own reasoning: reusing an email would let two scripts race to seed/clear the
// same auth.users row on concurrent runs.
//
// Run with:
//   pnpm exec tsx --env-file=.env.local --conditions=react-server scripts/verify-profile-verifications-select-policy.mts
// (--env-file loads this script's own Node process's Supabase credentials; --conditions=react-server
// is required because src/lib/supabase/admin.ts imports 'server-only'.)
//
// NOT run against the live project as part of this change: the migration this script depends on
// is checked in unapplied (this repo's normal pattern, and this issue's explicit fence — never
// apply a migration to a live database from an agent session). Until someone applies the
// migration by hand, checkProfileVerificationsTableExists above will fail this script fast with
// a clear message rather than a confusing downstream error.

const OWNER_EMAIL = 'verify-profile-verifications-owner@example.test'
const OTHER_EMAIL = 'verify-profile-verifications-other@example.test'

const OWNER_OTP_CODE = 'PV172OWNER'
const OWNER_SCRAPED_EMAIL = 'owner-scraped@flightlog.example.test'
const FUTURE_EXPIRY = new Date(Date.now() + 15 * 60 * 1000).toISOString()

const { report, finish } = createReporter()
const adminClient = createAdminClient()

// generateLink provisions the auth.users row on first call and mints a single-use OTP alongside
// it (this is Supabase auth's own sign-in OTP, unrelated to this table's otp_code column — the
// naming collision is coincidental), returning the same existing user on any later call for the
// same email. clearFixtureRows/deleteFixtureUsers below run at the end of every run, so this is
// normally a fresh row each time, but idempotency means a leftover user from an aborted prior run
// is picked up and reused safely instead of colliding.
async function resolveTestUser(email: string): Promise<{ userId: string; emailOtp: string }> {
  const { data, error } = await adminClient.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data.user?.id || !data.properties?.email_otp) {
    console.error(`could not provision fixture user ${email} via generateLink: ${error?.message ?? 'no user/email_otp returned'}`)
    process.exit(1)
  }
  return { userId: data.user.id, emailOtp: data.properties.email_otp }
}

// Scoped to only the two fixture user ids, safe to call before AND after the run — same
// reasoning as verify-follows-select-policy.mts's clearFixtureRows. Throws on a delete error
// rather than swallowing it, so a cleanup failure surfaces as itself instead of a confusing
// duplicate-key seed failure next run.
async function clearFixtureRows(ownerId: string, otherId: string): Promise<void> {
  const { error } = await adminClient.from('profile_verifications').delete().in('user_id', [ownerId, otherId])
  if (error) throw new Error(`failed to clear fixture profile_verifications rows: ${error.message}`)
}

// Never throws: called from the finally block, where an exception here would mask whatever
// exception the try block was already propagating. Each deleteUser call is wrapped individually
// so one fixture user's deletion failing doesn't skip the other's.
async function deleteFixtureUsers(ownerId: string, otherId: string): Promise<void> {
  for (const id of [ownerId, otherId]) {
    try {
      const { error } = await adminClient.auth.admin.deleteUser(id)
      if (error) console.error(`cleanup: failed to delete fixture auth user ${id}: ${error.message}`)
    } catch (err) {
      console.error(`cleanup: deleteUser threw for fixture auth user ${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function cleanupFixtures(ownerId: string, otherId: string): Promise<void> {
  try {
    await clearFixtureRows(ownerId, otherId)
  } catch (err) {
    console.error(`cleanup: failed to clear fixture rows: ${err instanceof Error ? err.message : String(err)}`)
  }
  await deleteFixtureUsers(ownerId, otherId)
}

// Seeds the owner's row via the RLS-bypassing admin client — this is the row both the positive
// (owner) and negative (other) assertions below read/write.
async function seedOwnerRow(ownerId: string): Promise<void> {
  const { error } = await adminClient.from('profile_verifications').insert({
    user_id: ownerId,
    status: 'pending',
    otp_code: OWNER_OTP_CODE,
    otp_expires_at: FUTURE_EXPIRY,
    email: OWNER_SCRAPED_EMAIL,
  })
  if (error) throw new Error(`failed to seed owner fixture row: ${error.message}`)
}

// Confirms, via the admin client, that the seeded row genuinely exists before any assertion runs
// through a session client — without this, a seed that silently inserted zero rows would make a
// "not visible" negative assertion pass vacuously.
async function confirmOwnerRowSeeded(ownerId: string): Promise<void> {
  const { data, error } = await adminClient.from('profile_verifications').select('user_id, otp_code').eq('user_id', ownerId)
  if (error) throw new Error(`failed to confirm seeded profile_verifications fixture via admin client: ${error.message}`)
  const rows = data ?? []
  report(
    rows.length === 1 && rows[0]?.otp_code === OWNER_OTP_CODE,
    "setup: the admin client confirms the owner's profile_verifications row was actually inserted",
  )
}

// The plain-Node equivalent of verify-follows-select-policy.mts's signInAsViewer, renamed for
// this script's owner/other fixture naming. Throws rather than process.exit on failure so the
// caller's finally block still runs cleanup.
async function signInAsUser(email: string, emailOtp: string): Promise<SupabaseClient> {
  const { url, anonKey } = requireSupabaseEnv()
  const sessionClient: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data, error } = await sessionClient.auth.verifyOtp({ email, token: emailOtp, type: 'email' })
  report(error === null, `sign-in: verifyOtp for ${email} succeeded (${error ? error.message : 'no error'})`)
  report(data.session !== null, `sign-in: verifyOtp returned a real session for ${email}`)
  if (error || !data.session) {
    throw new Error(`sign-in failed for ${email}: ${error ? error.message : 'verifyOtp returned no session'}`)
  }
  return sessionClient
}

async function assertOwnerCanReadOwnRow(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await ownerClient.from('profile_verifications').select('user_id, otp_code, status').eq('user_id', ownerId)

  report(error === null, `positive: owner reading their own row did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(
    error === null && rows.length === 1 && rows[0]?.otp_code === OWNER_OTP_CODE,
    `positive: the owner's own row IS visible through their own session (rows seen: ${JSON.stringify(rows)})`,
  )
}

// Proves the UPDATE policy actually grants the app's real upsert path (re-triggering
// verification), not just that SELECT works.
async function assertOwnerCanUpdateOwnRow(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const newCode = 'PV172RETRY'
  const { data, error } = await ownerClient
    .from('profile_verifications')
    .update({ otp_code: newCode })
    .eq('user_id', ownerId)
    .select('user_id, otp_code')

  report(error === null, `positive: owner updating their own row did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(
    error === null && rows.length === 1 && rows[0]?.otp_code === newCode,
    `positive: the owner's own row IS updatable through their own session (rows seen: ${JSON.stringify(rows)})`,
  )
}

async function assertOtherCannotReadOwnersRow(otherClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await otherClient.from('profile_verifications').select('user_id, otp_code').eq('user_id', ownerId)

  report(error === null, `negative: a different authenticated user reading the owner's row did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(
    error === null && rows.length === 0,
    `negative: the owner's row is NOT visible to a different authenticated user (rows seen: ${JSON.stringify(rows)})`,
  )
}

async function assertOtherCannotUpdateOwnersRow(otherClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await otherClient
    .from('profile_verifications')
    .update({ otp_code: 'HIJACKED' })
    .eq('user_id', ownerId)
    .select('user_id, otp_code')

  // RLS's UPDATE ... USING clause filters rows out of the update target entirely rather than
  // erroring, so a genuine deny looks like "0 rows affected", not a thrown error — same shape as
  // the read-side negative assertion above.
  report(error === null, `negative: a different authenticated user updating the owner's row did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(
    error === null && rows.length === 0,
    `negative: the owner's row is NOT updatable by a different authenticated user (rows seen: ${JSON.stringify(rows)})`,
  )
}

await checkProfileVerificationsTableExists(adminClient)

const { userId: ownerId, emailOtp: ownerEmailOtp } = await resolveTestUser(OWNER_EMAIL)
const { userId: otherId, emailOtp: otherEmailOtp } = await resolveTestUser(OTHER_EMAIL)

try {
  // Idempotent re-run safety: clear anything a previous (possibly aborted) run left behind
  // before seeding, same reasoning as verify-follows-select-policy.mts.
  await clearFixtureRows(ownerId, otherId)
  await seedOwnerRow(ownerId)
  await confirmOwnerRowSeeded(ownerId)

  const ownerClient = await signInAsUser(OWNER_EMAIL, ownerEmailOtp)
  await assertOwnerCanReadOwnRow(ownerClient, ownerId)
  await assertOwnerCanUpdateOwnRow(ownerClient, ownerId)

  const otherClient = await signInAsUser(OTHER_EMAIL, otherEmailOtp)
  await assertOtherCannotReadOwnersRow(otherClient, ownerId)
  await assertOtherCannotUpdateOwnersRow(otherClient, ownerId)
} finally {
  await cleanupFixtures(ownerId, otherId)
}

finish('profile_verifications RLS (owner can read/update their own row, no other user can) verification')
