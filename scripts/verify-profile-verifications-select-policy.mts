import { createHash } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkProfileVerificationsTableExists } from './lib/check-profile-verifications-table'
import { createReporter } from './lib/verify-report'
import { createAdminClient } from '../src/lib/supabase/admin'
import { requireSupabaseEnv } from '../src/lib/supabase/env'

// Proves supabase/migrations/20260813000000_create_profile_verifications.sql's RLS, its two
// SECURITY DEFINER functions (issue_pilot_verification, confirm_pilot_verification), and its
// pilot-id-change trigger are actually enforced on the live project — against REAL authenticated
// Supabase sessions, not a stubbed client. Pure Node script, no browser: the thing under test is
// PostgREST-level RLS/grants plus two RPC-exposed database functions. See
// verify-follows-select-policy.mts's own header comment for why persistSession: false is what
// makes @supabase/auth-js hold the session in memory rather than reaching for browser storage.
//
// This file's name and shape have carried across two prior rewrites (kept on purpose — nothing
// outside this file references the filename):
//   - Round 1 added the first real coverage of the INSERT policy (the original version only ever
//     exercised SELECT/UPDATE, seeded through the RLS-bypassing admin client) and separated
//     "other user can't even locate the row" from "the owner's own write is content-restricted".
//   - Round 2 added coverage for the owner being blocked from writing otp_expires_at and from
//     reading otp_code_hash back, on top of round 1's coverage.
//   - Round 3 (this version) follows the migration's redesign: there is no client-writable
//     INSERT/UPDATE surface left on this table at all, so most of round 1 and round 2's
//     INSERT/UPDATE-door mutation coverage is now moot — there is no door left to have a gap in.
//     What replaces it:
//       - assertDirectInsertIsPrivilegeDenied / assertDirectUpdateIsPrivilegeDenied /
//         assertDirectDeleteIsPrivilegeDenied: prove the table-level privilege is actually ABSENT
//         for the owner's own session, not merely that RLS filtered the attempt out. The
//         distinction matters (see 20260810010000_add_comments_soft_delete_policy.sql's own doc
//         comment on RLS's UPDATE ... USING clause silently returning "0 rows affected" instead
//         of erroring) — a privilege-level denial raises a Postgres error (42501) before RLS is
//         even consulted, so these assertions check for that error, not just an empty result.
//       - assertOwnerCannotSelectOtpCodeHash / assertOwnerCannotSelectStar: prove otp_code_hash
//         is excluded from the column-level SELECT grant itself (round 2's brute-forceable-hash
//         finding), not just hidden by app-code choosing not to ask for it.
//       - assertIssueVerificationEndToEnd / assertSpoofedPilotIdIsIgnored /
//         assertIssueWithoutLinkedPilotIdFails / assertReissueWhilePendingReplacesPriorCode:
//         exercise issue_pilot_verification (new in this round) via RPC, through a real session,
//         including round 1's original finding #3 (a caller-supplied pilot id must never be
//         trusted) replayed against the NEW write path that finding's own original fix didn't yet
//         cover (issuance wasn't a function yet in round 1).
//       - assertWrongCodeDoesNotConfirm / assertOtherUserCannotConfirmOwnersCode /
//         assertCorrectCodeConfirms / assertReplayedCodeDoesNotConfirm /
//         assertExpiredCodeDoesNotConfirm: confirm_pilot_verification's coverage, carried over
//         from round 2 essentially unchanged (only its internal hashing changed, from pgcrypto's
//         digest() to core Postgres's sha256() — this script's own sha256Hex helper below already
//         matches whichever the migration uses, so no assertion needed to change).
//       - assertPilotIdChangeInvalidatesVerification / assertUnrelatedProfileUpdateDoesNotInvalidate:
//         the pilot-id-change trigger, carried over from round 1/2 unchanged — this round's
//         changes don't touch it, but it's re-run here to confirm that's still true.
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
const UNLINKED_EMAIL = 'verify-profile-verifications-unlinked@example.test'

const OWNER_SCRAPED_EMAIL = 'owner-scraped@flightlog.example.test'

// Obviously-fake sentinel pilot ids tied to this issue, same convention as
// verify-follows-select-policy.mts's VIEWER_PILOT_ID/OTHER_PILOT_ID: flightlog_pilot_id has no
// FK/check constraint, so any integer works and there is no real pilot to collide with.
const OWNER_PILOT_ID = 900172
const OWNER_NEW_PILOT_ID = 900173
const SPOOFED_PILOT_ID = 900199

const CORRECT_CODE = 'PV172CORRECT'
const WRONG_CODE = 'PV172WRONGXX'
const EXPIRED_CODE = 'PV172EXPIRED'
const REISSUE_CODE = 'PV172REISSUE'

// Must match the migration's own hashing exactly (encode(sha256(convert_to(code, 'utf8')),
// 'hex')) — same algorithm, same lowercase-hex encoding, so a hash computed here and one computed
// by Postgres for the same plaintext are byte-for-byte identical. Only used below to seed an
// EXPIRED code directly via the admin client (issue_pilot_verification itself always computes a
// future expiry, so there is no RPC path that can produce an already-expired row — the same gap
// a real privileged issuance path would have, worked around here the same way).
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

// Scoped to only the three fixture user ids, safe to call before AND after the run.
async function clearFixtureRows(ownerId: string, otherId: string, unlinkedId: string): Promise<void> {
  const ids = [ownerId, otherId, unlinkedId]
  const { error: verificationsError } = await adminClient.from('profile_verifications').delete().in('user_id', ids)
  if (verificationsError) throw new Error(`failed to clear fixture profile_verifications rows: ${verificationsError.message}`)

  const { error: profilesError } = await adminClient.from('profiles').delete().in('user_id', ids)
  if (profilesError) throw new Error(`failed to clear fixture profiles rows: ${profilesError.message}`)
}

async function deleteFixtureUsers(ownerId: string, otherId: string, unlinkedId: string): Promise<void> {
  for (const id of [ownerId, otherId, unlinkedId]) {
    try {
      const { error } = await adminClient.auth.admin.deleteUser(id)
      if (error) console.error(`cleanup: failed to delete fixture auth user ${id}: ${error.message}`)
    } catch (err) {
      console.error(`cleanup: deleteUser threw for fixture auth user ${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function cleanupFixtures(ownerId: string, otherId: string, unlinkedId: string): Promise<void> {
  try {
    await clearFixtureRows(ownerId, otherId, unlinkedId)
  } catch (err) {
    console.error(`cleanup: failed to clear fixture rows: ${err instanceof Error ? err.message : String(err)}`)
  }
  await deleteFixtureUsers(ownerId, otherId, unlinkedId)
}

// OWNER and OTHER both need a profiles row with a linked pilot id: OWNER's backs
// issue_pilot_verification/the trigger test, OTHER's backs assertOtherCannotSelectOwnersRow
// needing a real session. UNLINKED deliberately gets NO profiles row at all — it's what
// assertIssueWithoutLinkedPilotIdFails calls issue_pilot_verification as. Seeded via the admin
// client — profiles' own RLS isn't what this script is testing, same reasoning
// verify-follows-select-policy.mts's seedFixtures uses for its profiles rows.
async function seedProfiles(ownerId: string, otherId: string): Promise<void> {
  const { error } = await adminClient.from('profiles').upsert(
    [
      { user_id: ownerId, flightlog_pilot_id: OWNER_PILOT_ID },
      { user_id: otherId, flightlog_pilot_id: OWNER_PILOT_ID + 1000 },
    ],
    { onConflict: 'user_id' },
  )
  if (error) throw new Error(`failed to seed fixture profiles: ${error.message}`)
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

// Round 3's headline property: there is no INSERT grant left at all, so this must fail with a
// Postgres privilege error (42501) raised before RLS is even consulted — not the "0 rows
// affected" shape a merely RLS-denied write produces (see this file's own module comment).
async function assertDirectInsertIsPrivilegeDenied(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await ownerClient
    .from('profile_verifications')
    .insert({ user_id: ownerId, status: 'pending', flightlog_pilot_id: OWNER_PILOT_ID, email: OWNER_SCRAPED_EMAIL })
    .select('user_id')

  report(error !== null, `negative: a direct INSERT was rejected outright (error: ${error?.message ?? 'none — BUG'})`)
  report(error?.code === '42501', `negative: the INSERT rejection is a table-level privilege denial (42501), not an RLS filter (code seen: ${error?.code ?? 'none'})`)
  report((data ?? []).length === 0, `negative: no row was created by the direct INSERT attempt (rows returned: ${JSON.stringify(data)})`)
}

async function assertDirectUpdateIsPrivilegeDenied(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await ownerClient.from('profile_verifications').update({ status: 'verified' }).eq('user_id', ownerId).select('user_id')

  report(error !== null, `negative: a direct UPDATE was rejected outright (error: ${error?.message ?? 'none — BUG'})`)
  report(error?.code === '42501', `negative: the UPDATE rejection is a table-level privilege denial (42501), not an RLS filter (code seen: ${error?.code ?? 'none'})`)
  report((data ?? []).length === 0, `negative: no row came back from the direct UPDATE attempt (rows returned: ${JSON.stringify(data)})`)
}

async function assertDirectDeleteIsPrivilegeDenied(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await ownerClient.from('profile_verifications').delete().eq('user_id', ownerId).select('user_id')

  report(error !== null, `negative: a direct DELETE was rejected outright (error: ${error?.message ?? 'none — BUG'})`)
  report(error?.code === '42501', `negative: the DELETE rejection is a table-level privilege denial (42501), not an RLS filter (code seen: ${error?.code ?? 'none'})`)
  report((data ?? []).length === 0, `negative: no row came back from the direct DELETE attempt (rows returned: ${JSON.stringify(data)})`)
}

// The self-forged-hash/brute-force finding from round 2: even though the owner can read their
// own row, otp_code_hash specifically must be excluded from the column-level SELECT grant, so
// asking for it by name errors instead of silently omitting it.
async function assertOwnerCannotSelectOtpCodeHash(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await ownerClient.from('profile_verifications').select('otp_code_hash').eq('user_id', ownerId)

  report(error !== null, `negative: selecting otp_code_hash by name was rejected (error: ${error?.message ?? 'none — BUG'})`)
  report((data ?? []).length === 0, `negative: no otp_code_hash value came back (rows returned: ${JSON.stringify(data)})`)
}

// select('*') expands to every column at parse time, so it must ALSO fail once otp_code_hash is
// excluded from the grant — not silently omit that one column and return the rest. Any call site
// elsewhere in the app must name columns explicitly instead (see the migration's own doc
// comment).
async function assertOwnerCannotSelectStar(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await ownerClient.from('profile_verifications').select('*').eq('user_id', ownerId)

  report(error !== null, `negative: select('*') was rejected because it implicitly includes otp_code_hash (error: ${error?.message ?? 'none — BUG'})`)
  report((data ?? []).length === 0, `negative: select('*') returned no rows (rows returned: ${JSON.stringify(data)})`)
}

async function assertOwnerCanReadOwnRow(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await ownerClient
    .from('profile_verifications')
    .select('user_id, status, otp_expires_at, flightlog_pilot_id, email, created_at')
    .eq('user_id', ownerId)

  report(error === null, `positive: the owner reading their own row via the explicit non-hash column list did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(rows.length === 1 && rows[0]?.user_id === ownerId, `positive: the owner's own row IS readable through their own session (rows seen: ${JSON.stringify(rows)})`)
}

async function assertOtherCannotSelectOwnersRow(otherClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await otherClient.from('profile_verifications').select('user_id, status').eq('user_id', ownerId)

  report(error === null, `negative: a different authenticated user reading the owner's row did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(error === null && rows.length === 0, `negative: the owner's row is NOT visible to a different authenticated user (rows seen: ${JSON.stringify(rows)})`)
}

async function callIssue(client: SupabaseClient, pilotId: number, scrapedEmail: string, code: string): Promise<{ error: string | null; code_: string | null }> {
  const { error } = await client.rpc('issue_pilot_verification', { pilot_id: pilotId, scraped_email: scrapedEmail, code })
  return { error: error?.message ?? null, code_: error?.code ?? null }
}

// The core end-to-end path: a real session issuing a real code, then reading it back through the
// admin client (bypassing this table's own now-nonexistent client SELECT-of-hash grant, which is
// exactly why the admin client — not the owner's session — is used to inspect otp_code_hash here).
async function assertIssueVerificationEndToEnd(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { error } = await callIssue(ownerClient, OWNER_PILOT_ID, OWNER_SCRAPED_EMAIL, CORRECT_CODE)
  report(error === null, `function: issue_pilot_verification succeeded for the owner's real linked pilot id (${error ?? 'ok'})`)

  const { data: row, error: readError } = await adminClient
    .from('profile_verifications')
    .select('status, otp_code_hash, otp_expires_at, flightlog_pilot_id, email')
    .eq('user_id', ownerId)
    .single()
  if (readError) throw new Error(`failed to read back owner row via admin client: ${readError.message}`)

  report(row?.status === 'pending', `function: the issued row is 'pending' (admin read: ${JSON.stringify(row)})`)
  report(row?.otp_code_hash === sha256Hex(CORRECT_CODE), 'function: otp_code_hash is the sha256 hex digest of the plaintext code, hashed server-side')
  report(row?.flightlog_pilot_id === OWNER_PILOT_ID, `function: flightlog_pilot_id matches the caller's real linked profile (${row?.flightlog_pilot_id})`)
  report(row?.email === OWNER_SCRAPED_EMAIL, 'function: email matches the scraped address passed in')
  report(new Date(row?.otp_expires_at as string).getTime() > Date.now(), 'function: otp_expires_at was computed server-side in the future')
}

// Round 1's finding #3, replayed against the NEW write path: a spoofed pilot_id argument must be
// ignored in favor of the calling user's real profiles.flightlog_pilot_id, never trusted as-is.
async function assertSpoofedPilotIdIsIgnored(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { error } = await callIssue(ownerClient, SPOOFED_PILOT_ID, OWNER_SCRAPED_EMAIL, REISSUE_CODE)
  report(error === null, `function: issue_pilot_verification with a spoofed pilot_id argument did not itself error (${error ?? 'ok'})`)

  const { data: row, error: readError } = await adminClient.from('profile_verifications').select('flightlog_pilot_id').eq('user_id', ownerId).single()
  if (readError) throw new Error(`failed to read back owner row via admin client: ${readError.message}`)
  report(
    row?.flightlog_pilot_id === OWNER_PILOT_ID,
    `negative: the stored flightlog_pilot_id is the REAL profiles value (${OWNER_PILOT_ID}), not the spoofed argument (${SPOOFED_PILOT_ID}) — stored: ${row?.flightlog_pilot_id}`,
  )
}

// A caller with no linked pilot id at all (no profiles row) must not be able to create a
// verification row for any pilot id — the function has nothing legitimate to bind it to.
async function assertIssueWithoutLinkedPilotIdFails(unlinkedClient: SupabaseClient, unlinkedId: string): Promise<void> {
  const { error, code_ } = await callIssue(unlinkedClient, 1, 'unlinked@example.test', 'IRRELEVANTCODE')
  report(error !== null, `negative: issue_pilot_verification for a caller with no linked profiles.flightlog_pilot_id was rejected (error: ${error ?? 'none — BUG'})`)
  report(code_ === 'P0001', `negative: the rejection is the function's own raised exception (P0001), not some other failure (code seen: ${code_ ?? 'none'})`)

  const { data: rows, error: readError } = await adminClient.from('profile_verifications').select('user_id').eq('user_id', unlinkedId)
  if (readError) throw new Error(`failed to read back unlinked-user rows via admin client: ${readError.message}`)
  report((rows ?? []).length === 0, `negative: no row was created for the unlinked caller (rows seen: ${JSON.stringify(rows)})`)
}

// Re-issuing while a row is already pending must replace the prior code/expiry, not error or
// leave two rows behind — the migration's own upsert (`on conflict (user_id) do update`).
async function assertReissueWhilePendingReplacesPriorCode(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { error } = await callIssue(ownerClient, OWNER_PILOT_ID, OWNER_SCRAPED_EMAIL, CORRECT_CODE)
  report(error === null, `function: re-issuing while pending did not error (${error ?? 'ok'})`)

  const { data: rows, error: readError } = await adminClient.from('profile_verifications').select('otp_code_hash').eq('user_id', ownerId)
  if (readError) throw new Error(`failed to read back owner rows via admin client: ${readError.message}`)
  report((rows ?? []).length === 1, `function: exactly one row exists for the owner after re-issuing (upsert, not a duplicate insert) — rows: ${JSON.stringify(rows)}`)
  report(rows?.[0]?.otp_code_hash === sha256Hex(CORRECT_CODE), 'function: the re-issued row holds the NEW code, replacing the spoofed-pilot-id call above')
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

// issue_pilot_verification always computes a future expiry, so there is no RPC path that
// produces an already-expired row — this seeds one directly via the admin client, the same way a
// privileged issuance path bypasses this table's client-facing grants entirely (service_role does
// on a real project, same as this script's adminClient).
async function seedExpiredCode(ownerId: string, code: string): Promise<void> {
  const { error } = await adminClient
    .from('profile_verifications')
    .update({ status: 'pending', otp_code_hash: sha256Hex(code), otp_expires_at: new Date(Date.now() - 60 * 1000).toISOString() })
    .eq('user_id', ownerId)
  if (error) throw new Error(`failed to seed an expired otp_code_hash via admin client: ${error.message}`)
}

async function assertExpiredCodeDoesNotConfirm(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { confirmed, error } = await confirmAs(ownerClient, EXPIRED_CODE)
  report(error === null, `function: calling confirm_pilot_verification with an expired code did not error (${error ?? 'ok'})`)
  report(confirmed === false, `function: an expired code does NOT confirm (returned: ${confirmed})`)

  const { data: row, error: readError } = await adminClient.from('profile_verifications').select('status').eq('user_id', ownerId).single()
  if (readError) throw new Error(`failed to read back owner row via admin client: ${readError.message}`)
  report(row?.status === 'pending', `function: the row stayed 'pending' after the expired-code attempt (admin read: ${JSON.stringify(row)})`)
}

// Round 1's finding #3: binds a verification to the exact pilot id it verified. Resets the
// owner's row to 'verified' bound to OWNER_PILOT_ID via the admin client first (independent of
// whatever state the confirm-function assertions above left it in), then changes the OWNER's own
// declared pilot id through their own session — the same write path a real profile edit uses —
// and asserts the trigger deleted the now-stale verification. Unaffected by round 3's changes,
// re-run here to confirm that's still true.
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
const { userId: unlinkedId, emailOtp: unlinkedEmailOtp } = await resolveTestUser(UNLINKED_EMAIL)

try {
  // Idempotent re-run safety: clear anything a previous (possibly aborted) run left behind
  // before seeding.
  await clearFixtureRows(ownerId, otherId, unlinkedId)
  await seedProfiles(ownerId, otherId)
  // unlinkedId deliberately gets no profiles row at all — see seedProfiles's own doc comment.

  const ownerClient = await signInAsUser(OWNER_EMAIL, ownerEmailOtp)
  const otherClient = await signInAsUser(OTHER_EMAIL, otherEmailOtp)
  const unlinkedClient = await signInAsUser(UNLINKED_EMAIL, unlinkedEmailOtp)

  await assertDirectInsertIsPrivilegeDenied(ownerClient, ownerId)
  await assertDirectUpdateIsPrivilegeDenied(ownerClient, ownerId)
  await assertDirectDeleteIsPrivilegeDenied(ownerClient, ownerId)

  await assertIssueVerificationEndToEnd(ownerClient, ownerId)
  await assertSpoofedPilotIdIsIgnored(ownerClient, ownerId)
  await assertIssueWithoutLinkedPilotIdFails(unlinkedClient, unlinkedId)
  await assertReissueWhilePendingReplacesPriorCode(ownerClient, ownerId)

  await assertOwnerCanReadOwnRow(ownerClient, ownerId)
  await assertOwnerCannotSelectOtpCodeHash(ownerClient, ownerId)
  await assertOwnerCannotSelectStar(ownerClient, ownerId)
  await assertOtherCannotSelectOwnersRow(otherClient, ownerId)

  await assertWrongCodeDoesNotConfirm(ownerClient)
  await assertOtherUserCannotConfirmOwnersCode(otherClient)
  await assertCorrectCodeConfirms(ownerClient, ownerId)
  await assertReplayedCodeDoesNotConfirm(ownerClient)

  await seedExpiredCode(ownerId, EXPIRED_CODE)
  await assertExpiredCodeDoesNotConfirm(ownerClient, ownerId)

  await assertPilotIdChangeInvalidatesVerification(ownerClient, ownerId)
  await assertUnrelatedProfileUpdateDoesNotInvalidate(ownerClient, ownerId)
} finally {
  await cleanupFixtures(ownerId, otherId, unlinkedId)
}

finish('profile_verifications privilege lock-down, issue_pilot_verification, confirm_pilot_verification, and the pilot-id-change trigger verification')
