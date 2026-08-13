import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkProfileVerificationsTableExists } from './lib/check-profile-verifications-table'
import { createReporter } from './lib/verify-report'
import { createAdminClient } from '../src/lib/supabase/admin'
import { requireSupabaseEnv } from '../src/lib/supabase/env'

// Proves supabase/migrations/20260813000000_create_profile_verifications.sql's RLS AND its
// SECURITY DEFINER confirm function AND its pilot-id-change trigger are actually enforced on the
// live project — against REAL authenticated Supabase sessions, not a stubbed client. Pure Node
// script, no browser: the thing under test is PostgREST-level RLS plus an RPC-exposed database
// function. See verify-follows-select-policy.mts's own header comment for why persistSession:
// false is what makes @supabase/auth-js hold the session in memory rather than reaching for
// browser storage.
//
// This file's original version (kept its name across the rewrite — nothing outside this file
// references the filename) only covered the SELECT/UPDATE positive+negative pair, seeded via the
// RLS-bypassing admin client. Review of the migration's first version found that coverage had two
// real holes:
//   1. The INSERT policy had zero coverage in either direction — seeding via the admin client
//      never exercises `with check` at all. Fixed below: assertOwnerCanInsertOwnPendingRow and
//      assertSpoofedUserIdInsertFails both insert through the OWNER'S OWN session.
//   2. "other user cannot update" was actually just re-testing the SELECT-negative path (proved by
//      mutation: relaxing the UPDATE policy's `using` clause to `(true)` still showed 0 rows
//      affected, because RLS ANDs the SELECT policy into every UPDATE's row-visibility check
//      regardless of `using` — see 20260810010000_add_comments_soft_delete_policy.sql's own doc
//      comment for the general mechanism). That assertion is kept below (still a real property:
//      OTHER can't even locate the row to attempt an update against), but it no longer stands in
//      for testing what the UPDATE policy's `with check` actually restricts — that's now covered
//      by assertOwnerCannotSelfVerifyViaUpdate below, which updates the OWNER's own row (so the
//      pre-image is visible) and asserts the specific write `with check` blocks.
//
// New coverage for this rewrite (issue #172's redesign, see the migration's own doc comment for
// the three findings it fixes):
//   - assertOwnerCannotSelfVerifyViaUpdate: a bare PATCH status='verified' on the owner's own
//     row, via the owner's own session, must fail — this is exploit #2 from the review, replayed
//     live against the fixed policy.
//   - assertOwnerCannotWriteOtpCodeHash: the owner's own session cannot write otp_code_hash via
//     UPDATE — proves the column-privilege revoke in the migration (not just the `with check`,
//     which cannot express a column-level restriction at all) is what's actually closing the
//     self-forged-hash variant of the same exploit.
//   - assertWrongCodeDoesNotConfirm / assertOtherUserCannotConfirmOwnersCode /
//     assertCorrectCodeConfirms / assertReplayedCodeDoesNotConfirm /
//     assertExpiredCodeDoesNotConfirm: exercise confirm_pilot_verification (the SECURITY DEFINER
//     function) via RPC, through real sessions, for every branch of its WHERE clause.
//   - assertPilotIdChangeInvalidatesVerification / assertUnrelatedProfileUpdateDoesNotInvalidate:
//     exercise the trigger that binds a verification to the specific pilot id it was issued for
//     (exploit #3 from the review).
//
// Run with:
//   pnpm exec tsx --env-file=.env.local --conditions=react-server scripts/verify-profile-verifications-select-policy.mts
// (--env-file loads this script's own Node process's Supabase credentials; --conditions=react-server
// is required because src/lib/supabase/admin.ts imports 'server-only'.)
//
// NOT run against the live project as part of this change: the migration this script depends on
// is checked in unapplied (this repo's normal pattern, and this issue's explicit fence — never
// apply a migration to a live database from an agent session). Until someone applies the
// migration by hand, checkProfileVerificationsTableExists below will fail this script fast with
// a clear message rather than a confusing downstream error. Real pass/fail for every assertion
// this script makes was instead measured against a throwaway local Postgres cluster with a
// hand-built auth.uid()/role harness mirroring Supabase's own — see the migration's own review
// trail for that evidence.

const OWNER_EMAIL = 'verify-profile-verifications-owner@example.test'
const OTHER_EMAIL = 'verify-profile-verifications-other@example.test'

const OWNER_SCRAPED_EMAIL = 'owner-scraped@flightlog.example.test'
const FUTURE_EXPIRY = new Date(Date.now() + 15 * 60 * 1000).toISOString()
const PAST_EXPIRY = new Date(Date.now() - 60 * 1000).toISOString()

// Obviously-fake sentinel pilot ids tied to this issue, same convention as
// verify-follows-select-policy.mts's VIEWER_PILOT_ID/OTHER_PILOT_ID: flightlog_pilot_id has no
// FK/check constraint, so any integer works and there is no real pilot to collide with.
const OWNER_PILOT_ID = 900172
const OWNER_NEW_PILOT_ID = 900173

const CORRECT_CODE = 'PV172CORRECT'
const WRONG_CODE = 'PV172WRONGXX'
const EXPIRED_CODE = 'PV172EXPIRED'

// Must match the migration's own hashing exactly (encode(digest(code, 'sha256'), 'hex')) — same
// algorithm, same lowercase-hex encoding, so a hash computed here and one computed by Postgres
// for the same plaintext are byte-for-byte identical.
function sha256Hex(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex')
}

const { report, finish } = createReporter()
const adminClient = createAdminClient()

// generateLink provisions the auth.users row on first call and mints a single-use OTP alongside
// it (this is Supabase auth's own sign-in OTP, unrelated to this table's otp_code_hash column —
// the naming collision is coincidental), returning the same existing user on any later call for
// the same email.
async function resolveTestUser(email: string): Promise<{ userId: string; emailOtp: string }> {
  const { data, error } = await adminClient.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data.user?.id || !data.properties?.email_otp) {
    console.error(`could not provision fixture user ${email} via generateLink: ${error?.message ?? 'no user/email_otp returned'}`)
    process.exit(1)
  }
  return { userId: data.user.id, emailOtp: data.properties.email_otp }
}

// Scoped to only the two fixture user ids, safe to call before AND after the run.
async function clearFixtureRows(ownerId: string, otherId: string): Promise<void> {
  const { error: verificationsError } = await adminClient.from('profile_verifications').delete().in('user_id', [ownerId, otherId])
  if (verificationsError) throw new Error(`failed to clear fixture profile_verifications rows: ${verificationsError.message}`)

  const { error: profilesError } = await adminClient.from('profiles').delete().in('user_id', [ownerId, otherId])
  if (profilesError) throw new Error(`failed to clear fixture profiles rows: ${profilesError.message}`)
}

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

// Only the owner needs a profiles row: it's what assertPilotIdChangeInvalidatesVerification
// updates to fire the trigger under test. Seeded via the admin client — profiles' own RLS isn't
// what this script is testing, so bypassing it here is fine (same reasoning
// verify-follows-select-policy.mts's seedFixtures uses for its profiles rows).
async function seedOwnerProfile(ownerId: string): Promise<void> {
  const { error } = await adminClient.from('profiles').upsert({ user_id: ownerId, flightlog_pilot_id: OWNER_PILOT_ID }, { onConflict: 'user_id' })
  if (error) throw new Error(`failed to seed owner fixture profile: ${error.message}`)
}

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

// Exercises the INSERT policy's `with check (auth.uid() = user_id ...)` directly: an owner
// trying to insert a row under a DIFFERENT user_id (spoofing) must be rejected, not silently
// re-targeted or ignored.
async function assertSpoofedUserIdInsertFails(ownerClient: SupabaseClient, otherId: string): Promise<void> {
  const { data, error } = await ownerClient
    .from('profile_verifications')
    .insert({ user_id: otherId, status: 'pending', flightlog_pilot_id: OWNER_PILOT_ID, email: OWNER_SCRAPED_EMAIL })
    .select('user_id')

  report(error !== null, `negative: inserting a row under a spoofed user_id (not the caller's own) was rejected (error: ${error?.message ?? 'none — BUG'})`)
  report((data ?? []).length === 0, `negative: no row was created by the spoofed-user_id insert attempt (rows returned: ${JSON.stringify(data)})`)
}

// The real seed for every assertion below this one: inserted through the OWNER'S OWN session,
// not the admin client, so this also doubles as the INSERT policy's positive case.
async function assertOwnerCanInsertOwnPendingRow(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await ownerClient
    .from('profile_verifications')
    .insert({ user_id: ownerId, status: 'pending', flightlog_pilot_id: OWNER_PILOT_ID, email: OWNER_SCRAPED_EMAIL })
    .select('user_id, status')

  report(error === null, `positive: owner inserting their own pending row did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(
    error === null && rows.length === 1 && rows[0]?.status === 'pending',
    `positive: the owner's own pending row IS insertable through their own session (rows seen: ${JSON.stringify(rows)})`,
  )
}

// Exploit #2 from the review, replayed live: a bare PATCH landing status='verified' directly,
// with no code ever confirmed, must be rejected by the UPDATE policy's `with check`.
async function assertOwnerCannotSelfVerifyViaUpdate(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await ownerClient.from('profile_verifications').update({ status: 'verified' }).eq('user_id', ownerId).select('user_id, status')

  report(error !== null, `negative: a direct PATCH status='verified' on the owner's own row was rejected (error: ${error?.message ?? 'none — BUG'})`)
  report((data ?? []).length === 0, `negative: no row came back verified from the direct-PATCH attempt (rows returned: ${JSON.stringify(data)})`)

  const { data: adminRow, error: adminError } = await adminClient.from('profile_verifications').select('status').eq('user_id', ownerId).single()
  if (adminError) throw new Error(`failed to read back owner row via admin client: ${adminError.message}`)
  report(adminRow?.status === 'pending', `negative: the owner's row genuinely stayed 'pending' after the rejected PATCH (admin read: ${JSON.stringify(adminRow)})`)
}

// The self-forged-hash variant of the same exploit: even with status pinned to 'pending', a
// client that could freely write otp_code_hash could stage a hash of a code they invented, then
// separately call confirm_pilot_verification with that same code to self-certify. This proves
// the migration's column-privilege revoke — not just the with-check — is what actually closes it,
// since Postgres RLS has no column-level policies to express "this column, not that one".
async function assertOwnerCannotWriteOtpCodeHash(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const forgedHash = sha256Hex('SELF-FORGED')
  const { data, error } = await ownerClient
    .from('profile_verifications')
    .update({ otp_code_hash: forgedHash })
    .eq('user_id', ownerId)
    .select('user_id, otp_code_hash')

  report(error !== null, `negative: owner writing otp_code_hash directly was rejected (error: ${error?.message ?? 'none — BUG'})`)
  report((data ?? []).length === 0, `negative: no row came back with the forged hash (rows returned: ${JSON.stringify(data)})`)
}

async function assertOtherCannotReadOwnersRow(otherClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await otherClient.from('profile_verifications').select('user_id, status').eq('user_id', ownerId)

  report(error === null, `negative: a different authenticated user reading the owner's row did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(error === null && rows.length === 0, `negative: the owner's row is NOT visible to a different authenticated user (rows seen: ${JSON.stringify(rows)})`)
}

// RLS's UPDATE ... USING clause filters rows out of the update target entirely rather than
// erroring, so a genuine deny looks like "0 rows affected", not a thrown error. This assertion
// proves OTHER can't even locate the row to attempt a write against — a distinct property from
// assertOwnerCannotSelfVerifyViaUpdate above, which proves the OWNER's own write is still
// content-restricted even though they CAN locate their own row.
async function assertOtherCannotUpdateOwnersRow(otherClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await otherClient.from('profile_verifications').update({ email: 'hijacked@example.test' }).eq('user_id', ownerId).select('user_id')

  report(error === null, `negative: a different authenticated user updating the owner's row did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(error === null && rows.length === 0, `negative: the owner's row is NOT updatable by a different authenticated user (rows seen: ${JSON.stringify(rows)})`)
}

// Simulates what issue #174's privileged issuance path does: hash a real code and stash it with
// a future expiry. Done via the admin client because the migration's own column-privilege revoke
// means no user-scoped client — owner's or otherwise — can write otp_code_hash (see
// assertOwnerCannotWriteOtpCodeHash above), which is the point.
async function seedRealCode(ownerId: string, code: string, expiresAt: string): Promise<void> {
  const { error } = await adminClient
    .from('profile_verifications')
    .update({ status: 'pending', otp_code_hash: sha256Hex(code), otp_expires_at: expiresAt })
    .eq('user_id', ownerId)
  if (error) throw new Error(`failed to seed a real otp_code_hash via admin client: ${error.message}`)
}

async function confirmAs(client: SupabaseClient, code: string): Promise<{ confirmed: boolean | null; error: string | null }> {
  const { data, error } = await client.rpc('confirm_pilot_verification', { submitted_code: code })
  return { confirmed: (data as boolean | null) ?? null, error: error?.message ?? null }
}

async function assertWrongCodeDoesNotConfirm(ownerClient: SupabaseClient): Promise<void> {
  const { confirmed, error } = await confirmAs(ownerClient, WRONG_CODE)
  report(error === null, `function: calling confirm_pilot_verification with a wrong code did not error (${error ?? 'ok'})`)
  report(confirmed === false, `function: a wrong code does NOT confirm (returned: ${confirmed})`)
}

// auth.uid() is derived server-side inside the function from the CALLER's own session, never
// from a caller-supplied id — so even though OTHER submits the exact plaintext code that matches
// the owner's stored hash, the function's `where user_id = auth.uid()` still only ever matches
// OTHER's own (nonexistent) row, not the owner's.
async function assertOtherUserCannotConfirmOwnersCode(otherClient: SupabaseClient): Promise<void> {
  const { confirmed, error } = await confirmAs(otherClient, CORRECT_CODE)
  report(error === null, `function: a different authenticated user calling confirm_pilot_verification did not error (${error ?? 'ok'})`)
  report(confirmed === false, `function: a different authenticated user cannot confirm the owner's code, even with the correct plaintext (returned: ${confirmed})`)
}

async function assertCorrectCodeConfirms(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { confirmed, error } = await confirmAs(ownerClient, CORRECT_CODE)
  report(error === null, `function: calling confirm_pilot_verification with the correct code did not error (${error ?? 'ok'})`)
  report(confirmed === true, `function: the correct code DOES confirm (returned: ${confirmed})`)

  const { data: row, error: readError } = await adminClient
    .from('profile_verifications')
    .select('status, otp_code_hash, otp_expires_at')
    .eq('user_id', ownerId)
    .single()
  if (readError) throw new Error(`failed to read back owner row via admin client: ${readError.message}`)
  report(row?.status === 'verified', `function: status flipped to 'verified' after a correct confirm (admin read: ${JSON.stringify(row)})`)
  report(
    row?.otp_code_hash === null && row?.otp_expires_at === null,
    `function: otp_code_hash/otp_expires_at were cleared after a correct confirm, so the code can't be replayed (admin read: ${JSON.stringify(row)})`,
  )
}

async function assertReplayedCodeDoesNotConfirm(ownerClient: SupabaseClient): Promise<void> {
  const { confirmed, error } = await confirmAs(ownerClient, CORRECT_CODE)
  report(error === null, `function: replaying an already-used code did not error (${error ?? 'ok'})`)
  report(confirmed === false, `function: a used/already-verified code cannot be replayed (returned: ${confirmed})`)
}

async function assertExpiredCodeDoesNotConfirm(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { confirmed, error } = await confirmAs(ownerClient, EXPIRED_CODE)
  report(error === null, `function: calling confirm_pilot_verification with an expired code did not error (${error ?? 'ok'})`)
  report(confirmed === false, `function: an expired code does NOT confirm (returned: ${confirmed})`)

  const { data: row, error: readError } = await adminClient.from('profile_verifications').select('status').eq('user_id', ownerId).single()
  if (readError) throw new Error(`failed to read back owner row via admin client: ${readError.message}`)
  report(row?.status === 'pending', `function: the row stayed 'pending' after the expired-code attempt (admin read: ${JSON.stringify(row)})`)
}

// Exploit #3 from the review: binds a verification to the exact pilot id it verified. Resets the
// owner's row to 'verified' bound to OWNER_PILOT_ID via the admin client first (independent of
// whatever state the confirm-function assertions above left it in), then changes the OWNER's own
// declared pilot id through their own session — the same write path a real profile edit uses —
// and asserts the trigger deleted the now-stale verification.
async function assertPilotIdChangeInvalidatesVerification(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { error: seedError } = await adminClient
    .from('profile_verifications')
    .update({ status: 'verified', flightlog_pilot_id: OWNER_PILOT_ID, otp_code_hash: null, otp_expires_at: null })
    .eq('user_id', ownerId)
  if (seedError) throw new Error(`failed to seed a verified row for the trigger test: ${seedError.message}`)

  const { error: updateError } = await ownerClient.from('profiles').update({ flightlog_pilot_id: OWNER_NEW_PILOT_ID }).eq('user_id', ownerId)
  report(updateError === null, `trigger: changing the owner's declared pilot id did not error (${updateError ? updateError.message : 'ok'})`)

  const { data: rows, error: readError } = await adminClient.from('profile_verifications').select('user_id').eq('user_id', ownerId)
  if (readError) throw new Error(`failed to read back profile_verifications via admin client: ${readError.message}`)
  report(
    (rows ?? []).length === 0,
    `trigger: the stale verification row was deleted once profiles.flightlog_pilot_id changed to a different value (rows seen: ${JSON.stringify(rows)})`,
  )
}

// Proves the trigger's WHEN clause is actually scoped to pilot-id changes, not "any profile
// update" — otherwise assertPilotIdChangeInvalidatesVerification above could pass for the wrong
// reason (a trigger that fires on every UPDATE, unconditionally deleting the row).
async function assertUnrelatedProfileUpdateDoesNotInvalidate(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { error: seedError } = await adminClient
    .from('profile_verifications')
    .update({ status: 'verified', flightlog_pilot_id: OWNER_NEW_PILOT_ID, otp_code_hash: null, otp_expires_at: null })
    .eq('user_id', ownerId)
  if (seedError) throw new Error(`failed to re-seed a verified row: ${seedError.message}`)

  const { error: updateError } = await ownerClient.from('profiles').update({ display_name: 'Verify Profile Verifications Owner' }).eq('user_id', ownerId)
  report(updateError === null, `trigger: an unrelated profile update (display_name) did not error (${updateError ? updateError.message : 'ok'})`)

  const { data: rows, error: readError } = await adminClient.from('profile_verifications').select('user_id').eq('user_id', ownerId)
  if (readError) throw new Error(`failed to read back profile_verifications via admin client: ${readError.message}`)
  report((rows ?? []).length === 1, `trigger: an unrelated profile update did NOT invalidate the verification (rows seen: ${JSON.stringify(rows)})`)
}

await checkProfileVerificationsTableExists(adminClient)

const { userId: ownerId, emailOtp: ownerEmailOtp } = await resolveTestUser(OWNER_EMAIL)
const { userId: otherId, emailOtp: otherEmailOtp } = await resolveTestUser(OTHER_EMAIL)

try {
  // Idempotent re-run safety: clear anything a previous (possibly aborted) run left behind
  // before seeding.
  await clearFixtureRows(ownerId, otherId)
  await seedOwnerProfile(ownerId)

  const ownerClient = await signInAsUser(OWNER_EMAIL, ownerEmailOtp)
  const otherClient = await signInAsUser(OTHER_EMAIL, otherEmailOtp)

  await assertSpoofedUserIdInsertFails(ownerClient, otherId)
  await assertOwnerCanInsertOwnPendingRow(ownerClient, ownerId)
  await assertOwnerCannotSelfVerifyViaUpdate(ownerClient, ownerId)
  await assertOwnerCannotWriteOtpCodeHash(ownerClient, ownerId)
  await assertOtherCannotReadOwnersRow(otherClient, ownerId)
  await assertOtherCannotUpdateOwnersRow(otherClient, ownerId)

  await seedRealCode(ownerId, CORRECT_CODE, FUTURE_EXPIRY)
  await assertWrongCodeDoesNotConfirm(ownerClient)
  await assertOtherUserCannotConfirmOwnersCode(otherClient)
  await assertCorrectCodeConfirms(ownerClient, ownerId)
  await assertReplayedCodeDoesNotConfirm(ownerClient)

  await seedRealCode(ownerId, EXPIRED_CODE, PAST_EXPIRY)
  await assertExpiredCodeDoesNotConfirm(ownerClient, ownerId)

  await assertPilotIdChangeInvalidatesVerification(ownerClient, ownerId)
  await assertUnrelatedProfileUpdateDoesNotInvalidate(ownerClient, ownerId)
} finally {
  await cleanupFixtures(ownerId, otherId)
}

finish('profile_verifications RLS, confirm_pilot_verification, and the pilot-id-change trigger verification')
