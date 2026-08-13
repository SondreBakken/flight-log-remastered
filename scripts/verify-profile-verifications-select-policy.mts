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
// This file's name and shape have carried across three prior rewrites (kept on purpose — nothing
// outside this file references the filename):
//   - Round 1 added the first real coverage of the INSERT policy (the original version only ever
//     exercised SELECT/UPDATE, seeded through the RLS-bypassing admin client) and separated
//     "other user can't even locate the row" from "the owner's own write is content-restricted".
//   - Round 2 added coverage for the owner being blocked from writing otp_expires_at and from
//     reading otp_code_hash back, on top of round 1's coverage.
//   - Round 3 followed the migration's redesign: there is no client-writable INSERT/UPDATE
//     surface left on this table at all, so most of round 1 and round 2's INSERT/UPDATE-door
//     mutation coverage became moot — there is no door left to have a gap in. What replaced it:
//       - assertDirectInsertIsPrivilegeDenied / assertDirectUpdateIsPrivilegeDenied /
//         assertDirectDeleteIsPrivilegeDenied: prove the table-level privilege is actually ABSENT
//         for the owner's own session, not merely that RLS filtered the attempt out. The
//         distinction matters (see 20260810010000_add_comments_soft_delete_policy.sql's own doc
//         comment on RLS's UPDATE ... USING clause silently returning "0 rows affected" instead
//         of erroring) — a privilege-level denial raises a Postgres error (42501) before RLS is
//         even consulted, so these assertions check for that error, not just an empty result.
//         NOTE (round 4): this reasoning holds exactly for UPDATE/DELETE, but NOT for INSERT — a
//         real Postgres cluster measurement found an RLS-only INSERT denial (grant present, no
//         permissive policy) ALSO raises 42501 ("new row violates row-level security policy"),
//         the same code a bare privilege denial raises. assertDirectInsertIsPrivilegeDenied's own
//         label below has been corrected to not claim a distinction that doesn't hold for INSERT.
//       - assertOwnerCannotSelectOtpCodeHash / assertOwnerCannotSelectStar: prove otp_code_hash
//         is excluded from the column-level SELECT grant itself (round 2's brute-forceable-hash
//         finding), not just hidden by app-code choosing not to ask for it.
//       - issue_pilot_verification (new in round 3) coverage, via RPC through a real session,
//         including round 1's original finding #3 (a caller-supplied pilot id must never be
//         trusted) replayed against the NEW write path that finding's own original fix didn't yet
//         cover (issuance wasn't a function yet in round 1). SUPERSEDED by round 4 below.
//       - assertWrongCodeDoesNotConfirm / assertOtherUserCannotConfirmOwnersCode /
//         assertCorrectCodeConfirms / assertReplayedCodeDoesNotConfirm /
//         assertExpiredCodeDoesNotConfirm: confirm_pilot_verification's coverage, carried over
//         from round 2 essentially unchanged (only its internal hashing changed, from pgcrypto's
//         digest() to core Postgres's sha256() — this script's own sha256Hex helper below already
//         matches whichever the migration uses, so no assertion needed to change).
//       - assertPilotIdChangeInvalidatesVerification / assertUnrelatedProfileUpdateDoesNotInvalidate:
//         the pilot-id-change trigger, carried over from round 1/2 unchanged — round 3's changes
//         didn't touch it, and round 4's don't either, but it's re-run here to confirm that stays
//         true.
//   - ROUND 4 (this version) closes the last hole: `issue_pilot_verification` was authenticated-
//     callable with a caller-chosen `code`, letting any signed-in user (having self-declared
//     someone else's pilot id via #138's separate surface) mint and immediately confirm their own
//     verification with no email ever sent. The fix moves EXECUTE from `authenticated` to
//     `service_role` only, and drops the now-fully-unused `pilot_id` parameter (see the
//     migration's own doc comment for the full reasoning). This inverts round 3's coverage
//     instead of extending it:
//       - assertOwnerCannotIssueVerificationDirectly REPLACES round 3's
//         assertIssueVerificationEndToEnd: the owner's own authenticated session calling
//         issue_pilot_verification must now be DENIED outright (42501), proving the exploit this
//         round closes is actually closed. Since EVERY authenticated caller is now denied at the
//         privilege layer regardless of what arguments they pass, round 3's per-argument-scenario
//         coverage through an authenticated session (a spoofed pilot_id being ignored, an unlinked
//         caller being rejected, re-issuing while pending replacing the prior code) is now moot by
//         construction the same way round 3's own module comment already argued for the
//         INSERT/UPDATE-door coverage it replaced: there is no argument surface left for
//         `authenticated` to exploit, so scenario-by-scenario coverage of that surface has nothing
//         left to distinguish. The spoofed-pilot-id scenario specifically no longer has an
//         argument to spoof at all (the parameter is gone).
//       - assertServiceRoleReachesIssueVerificationBody is the "fix itself is exercised, not just
//         the vulnerability's absence" positive control: proves service_role's EXECUTE grant
//         actually works (the call is not blocked by the SAME 42501 the owner's call above hits),
//         by asserting the resulting error code is specifically the function's OWN raised
//         exception (P0001, "no flightlog pilot id linked to the calling profile") rather than a
//         privilege denial. This is genuinely equivalent coverage to round 3's
//         assertIssueWithoutLinkedPilotIdFails, not a downgrade: this script's adminClient (a bare
//         service_role key, via src/lib/supabase/admin.ts's createAdminClient) carries no JWT
//         `sub` claim, so auth.uid() resolves to null for it exactly the way it would for a caller
//         with no linked profiles row — the "unlinked caller" business path and the "service-role
//         call with no forwarded identity" path are the same code path. A KNOWN GAP this
//         surfaces: neither this script nor #176 yet has a way to make a service_role-privileged
//         call ALSO carry a specific user's identity (that needs either a signed JWT with a `sub`
//         claim, which requires the project's JWT secret — not available to this script — or a
//         deliberate design decision in #176 for how to pass identity to a trusted-server-only
//         call). Full end-to-end proof that issue_pilot_verification's own body (hashing, expiry,
//         upsert, pilot-id derivation) is correct when it DOES have an identity to work with comes
//         from this migration's own review trail (a real Postgres cluster, hand-driving `role` and
//         the `request.jwt.claim.sub` GUC together) — see the migration's own doc comment history.
//       - seedPendingVerification replaces issue_pilot_verification-via-ownerClient as this
//         script's own way of getting a `pending` row with a KNOWN plaintext code in place before
//         the confirm_pilot_verification assertions below run: a direct admin-client table write
//         (the same technique seedExpiredCode already used pre-round-4 for the expired-code case),
//         not a call through the now-locked-down RPC.
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

// Obviously-fake sentinel pilot ids tied to this issue, same convention as
// verify-follows-select-policy.mts's VIEWER_PILOT_ID/OTHER_PILOT_ID: flightlog_pilot_id has no
// FK/check constraint, so any integer works and there is no real pilot to collide with.
const OWNER_PILOT_ID = 900172
const OWNER_NEW_PILOT_ID = 900173

const CORRECT_CODE = 'PV172CORRECT'
const WRONG_CODE = 'PV172WRONGXX'
const EXPIRED_CODE = 'PV172EXPIRED'

// Must match the migration's own hashing exactly (encode(sha256(convert_to(code, 'utf8')),
// 'hex')) — same algorithm, same lowercase-hex encoding, so a hash computed here and one computed
// by Postgres for the same plaintext are byte-for-byte identical. Used to seed both the
// known-plaintext pending row the confirm_pilot_verification assertions need (seedPendingVerification)
// and the EXPIRED code case (seedExpiredCode) — both go straight through the admin client's table
// access rather than through issue_pilot_verification, which round 4 locked down to service_role
// only (see this file's own module comment for why that RPC can no longer be this script's way of
// seeding a row).
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
  const ids = [ownerId, otherId]
  const { error: verificationsError } = await adminClient.from('profile_verifications').delete().in('user_id', ids)
  if (verificationsError) throw new Error(`failed to clear fixture profile_verifications rows: ${verificationsError.message}`)

  const { error: profilesError } = await adminClient.from('profiles').delete().in('user_id', ids)
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

// OWNER and OTHER both need a profiles row with a linked pilot id: OWNER's backs
// issue_pilot_verification/the trigger test, OTHER's backs assertOtherCannotSelectOwnersRow
// needing a real session. No UNLINKED fixture (round 3 had one, solely for
// assertIssueWithoutLinkedPilotIdFails): round 4 covers that same "no linked profile" business
// path a different way — see assertServiceRoleReachesIssueVerificationBody's own doc comment.
// Seeded via the admin client — profiles' own RLS isn't what this script is testing, same
// reasoning verify-follows-select-policy.mts's seedFixtures uses for its profiles rows.
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

// Round 3's headline property: there is no INSERT grant left at all, so this must fail outright.
// Unlike the UPDATE/DELETE assertions below, this does NOT also claim the failure is
// specifically a table-level privilege denial rather than an RLS filter: measured on a real
// Postgres cluster (round 4), an RLS-only INSERT denial (grant present, no permissive policy)
// raises the SAME 42501 SQLSTATE as a bare privilege denial does ("new row violates row-level
// security policy" vs. "permission denied for table", both 42501) — the distinction that DOES
// hold for UPDATE/DELETE (RLS there silently returns 0 affected rows instead of erroring; see
// 20260810010000_add_comments_soft_delete_policy.sql's own doc comment) simply doesn't exist for
// INSERT. 42501 here just confirms "denied", not "denied specifically at the grant layer".
async function assertDirectInsertIsPrivilegeDenied(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { data, error } = await ownerClient
    .from('profile_verifications')
    .insert({ user_id: ownerId, status: 'pending', flightlog_pilot_id: OWNER_PILOT_ID, email: OWNER_SCRAPED_EMAIL })
    .select('user_id')

  report(error !== null, `negative: a direct INSERT was rejected outright (error: ${error?.message ?? 'none — BUG'})`)
  report(error?.code === '42501', `negative: the INSERT rejection is 42501 (code seen: ${error?.code ?? 'none'})`)
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

async function callIssue(client: SupabaseClient, scrapedEmail: string, code: string): Promise<{ error: string | null; code_: string | null }> {
  const { error } = await client.rpc('issue_pilot_verification', { scraped_email: scrapedEmail, code })
  return { error: error?.message ?? null, code_: error?.code ?? null }
}

// THE critical fix this round proves closed: round 3 granted issue_pilot_verification's EXECUTE
// to `authenticated`, which let any signed-in user call it directly with a code of their own
// choosing (then immediately confirm that same code) — no email ever sent. Round 4 revokes that
// grant entirely. The owner's own real, correctly-linked session must now be denied outright, at
// the privilege layer, before the function body (and its `code` argument) is ever reached —
// exactly the same 42501-before-RLS shape assertDirectInsertIsPrivilegeDenied et al. already
// establish for the table's own INSERT/UPDATE/DELETE grants above.
async function assertOwnerCannotIssueVerificationDirectly(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { error, code_ } = await callIssue(ownerClient, OWNER_SCRAPED_EMAIL, 'ATTACKER-CHOSEN-CODE')
  report(error !== null, `negative: the owner's own authenticated session calling issue_pilot_verification directly was rejected (error: ${error ?? 'none — BUG'})`)
  report(code_ === '42501', `negative: the rejection is a table-level privilege denial (42501), raised before the function body (and its caller-supplied code) is ever reached (code seen: ${code_ ?? 'none'})`)

  const { data: rows, error: readError } = await adminClient.from('profile_verifications').select('user_id').eq('user_id', ownerId)
  if (readError) throw new Error(`failed to read back owner rows via admin client: ${readError.message}`)
  report((rows ?? []).length === 0, `negative: no row was created by the denied direct call (rows seen: ${JSON.stringify(rows)})`)
}

// Positive control mirroring the negative one above: service_role's EXECUTE grant must actually
// work, not just exist on paper — "the fix itself is exercised, not just the vulnerability's
// absence". adminClient (src/lib/supabase/admin.ts's createAdminClient, a bare service_role key)
// carries no JWT `sub` claim, so auth.uid() resolves to null for it — the SAME condition a caller
// with no linked profiles row hits, which is exactly what round 3's now-removed
// assertIssueWithoutLinkedPilotIdFails tested via a dedicated UNLINKED fixture user. That
// coverage is preserved here, not lost: the assertion below distinguishes "blocked by the grant"
// (42501, would mean this round's fix is broken) from "reached the function body and hit its own
// business-rule exception" (P0001, "no flightlog pilot id linked to the calling profile" — proves
// service_role passed the grant AND the function's own validation still runs correctly).
//
// What this does NOT cover: a full round-trip where service_role's call is also scoped to a
// SPECIFIC user's identity (so the function derives and stores a real flightlog_pilot_id). Doing
// that requires a JWT carrying both role=service_role and a sub claim, which requires signing a
// custom token with the project's JWT secret — not available to this script (only the anon key
// and service role key are configured; see src/lib/supabase/env.ts / admin.ts). #176's server
// action will need to settle how a service_role-privileged call carries a specific user's
// identity; this script proves the GRANT itself is correct and the function is reachable, which
// is what round 4 changed. issue_pilot_verification's own body (hashing, expiry, upsert,
// pilot-id-from-profiles derivation) was independently proven correct end-to-end against a real
// Postgres cluster with `role` and `request.jwt.claim.sub` both under direct control — see this
// migration's own doc comment / review trail for that evidence.
async function assertServiceRoleReachesIssueVerificationBody(): Promise<void> {
  const { error, code_ } = await callIssue(adminClient, 'service-role-probe@example.test', 'IRRELEVANT-CODE')
  report(error !== null, `function: service_role's call was not silently accepted with no linked identity to work from (error: ${error ?? 'none'})`)
  report(code_ !== '42501', `positive: service_role's call was NOT blocked by a privilege denial, unlike the owner's direct call above (code seen: ${code_ ?? 'none'})`)
  report(code_ === 'P0001', `positive: service_role passed the grant and reached the function body, which correctly raised its own "no linked pilot id" exception for a caller with no forwarded identity (code seen: ${code_ ?? 'none'})`)
}

// This round's write-surface lock-down means issue_pilot_verification can no longer be this
// script's own way of seeding a `pending` row with a known plaintext code before the
// confirm_pilot_verification assertions below run (see assertServiceRoleReachesIssueVerificationBody's
// own doc comment for why). Seeds the same shape directly via the admin client instead — the same
// technique seedExpiredCode already used for the expired-code case.
async function seedPendingVerification(ownerId: string, code: string): Promise<void> {
  const { error } = await adminClient.from('profile_verifications').upsert(
    {
      user_id: ownerId,
      status: 'pending',
      otp_code_hash: sha256Hex(code),
      otp_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      flightlog_pilot_id: OWNER_PILOT_ID,
      email: OWNER_SCRAPED_EMAIL,
    },
    { onConflict: 'user_id' },
  )
  if (error) throw new Error(`failed to seed a pending profile_verifications row via admin client: ${error.message}`)
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

try {
  // Idempotent re-run safety: clear anything a previous (possibly aborted) run left behind
  // before seeding.
  await clearFixtureRows(ownerId, otherId)
  await seedProfiles(ownerId, otherId)

  const ownerClient = await signInAsUser(OWNER_EMAIL, ownerEmailOtp)
  const otherClient = await signInAsUser(OTHER_EMAIL, otherEmailOtp)

  await assertDirectInsertIsPrivilegeDenied(ownerClient, ownerId)
  await assertDirectUpdateIsPrivilegeDenied(ownerClient, ownerId)
  await assertDirectDeleteIsPrivilegeDenied(ownerClient, ownerId)

  await assertOwnerCannotIssueVerificationDirectly(ownerClient, ownerId)
  await assertServiceRoleReachesIssueVerificationBody()
  await seedPendingVerification(ownerId, CORRECT_CODE)

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
  await cleanupFixtures(ownerId, otherId)
}

finish('profile_verifications privilege lock-down, issue_pilot_verification, confirm_pilot_verification, and the pilot-id-change trigger verification')
