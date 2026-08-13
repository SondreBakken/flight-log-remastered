import { createHash, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkProfileVerificationIssuanceTableExists, checkProfileVerificationsTableExists } from './lib/check-profile-verifications-table'
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
//       - assertServiceRoleReachesIssueVerificationBody was the "fix itself is exercised, not
//         just the vulnerability's absence" positive control for round 4: it could only ever
//         prove service_role's EXECUTE grant existed, not that a call through it could actually
//         SUCCEED — round 4's version had no way to give a service_role call a specific identity
//         (auth.uid() was always null under it), so this assertion's "positive" case and its
//         negative case (an unlinked caller) were accidentally the same code path for the wrong
//         reason. SUPERSEDED by round 5's assertServiceRoleIssuesVerificationForLinkedUser /
//         assertServiceRoleIssueWithoutLinkedPilotIdFails below, once `target_user_id` gave the
//         function a way to receive an identity that isn't tied to auth.uid() at all.
//       - seedPendingVerification (round 4) got replaced again in round 5, see below.
//   - ROUND 5 (this version) fixes a functional dead end round 4 left behind, plus two coverage
//     gaps the same round's own review flagged:
//       - issue_pilot_verification gained an explicit `target_user_id uuid` parameter, because
//         round 4's `auth.uid()`-derived version could never be called successfully by anyone
//         (service_role has no `sub` claim, so auth.uid() was always null under it; a JWT WITH a
//         `sub` has role `authenticated`, which has no EXECUTE grant — the two requirements were
//         mutually exclusive). callIssue now takes a target user id as its first RPC argument.
//       - assertServiceRoleReachesIssueVerificationBody is REPLACED by two assertions that are
//         actually meaningful now that a real identity can be passed through:
//         assertServiceRoleIssuesVerificationForLinkedUser is the genuine positive control round
//         4's version was missing — a real target_user_id WITH a linked profiles row, called via
//         service_role, must actually succeed and persist the right hash/expiry/pilot_id/email.
//         It doubles as this script's own way of seeding the `pending` row the
//         confirm_pilot_verification assertions below need (replacing round 4's
//         seedPendingVerification direct-table-write workaround — now that the RPC can succeed,
//         seeding through it is both more realistic and less code).
//         assertServiceRoleIssueWithoutLinkedPilotIdFails is the negative case, now for the RIGHT
//         reason: a target_user_id with no profiles row raises P0001 because there's genuinely no
//         linked pilot id, not because auth.uid() happened to be null regardless of what's
//         linked (round 4's version couldn't distinguish those two causes; this one can, because
//         the "who" is no longer derived from a session that never carries one under
//         service_role).
//       - assertTruncateIsClosedForClientRoles / assertAnonHasNoSelectGrantAtAll: PostgREST has
//         no TRUNCATE verb, so nothing previously asserted the round-3/round-4 TRUNCATE revoke
//         actually stuck (unlike INSERT/UPDATE/DELETE above, which get probed directly). Both
//         read supabase/migrations/20260813000000_create_profile_verifications.sql's own new
//         profile_verifications_privilege_grants() RPC (service_role-only, see that function's
//         doc comment for why a dedicated RPC instead of information_schema — PostgREST doesn't
//         expose that schema at all) and check the grant catalog directly: neither `anon` nor
//         `authenticated` holds TRUNCATE, and `anon` holds no column-level SELECT grant on this
//         table at all (this migration's SELECT revoke was previously scoped to `authenticated`
//         only, an inconsistency with zero live effect given the row-level policy but pinned
//         here anyway).
//   - ROUND 6 (this version) adds coverage for issue #181's re-issuance cooldown
//     (20260813030000_rate_limit_issue_pilot_verification.sql, rewritten after review against a
//     real Postgres cluster found the first version bypassable via a pilot-id relink and
//     vulnerable to a check-then-act TOCTOU — see that migration's own doc comment for both
//     defects and their fixes). assertServiceRoleIssueWithinCooldownIsRateLimited is the
//     PostgREST-level round-trip proof that RL001 actually reaches a caller as `error.code`, not
//     just something reasoned about from the plpgsql source: it reuses
//     assertServiceRoleIssuesVerificationForLinkedUser's own just-completed issuance as call #1,
//     immediately re-issues for the SAME target_user_id, and asserts the second call is rejected
//     with error.code === 'RL001' — well inside the 60-second cooldown window, and confirms the
//     rejected call left the prior code's hash untouched.
//   - ROUND 7 (this version) fixes a defect round 6's own fix introduced (round 2 of this
//     migration's review trail: the cooldown upsert ran BEFORE the "no linked pilot id" check,
//     so an unlinked target_user_id hit profile_verification_issuance's auth.users FK and raised
//     23503 instead of the expected P0001 — closed by reordering the migration's function body,
//     see that migration's own doc comment) and adds the three should-fix gaps round 2's review
//     flagged but didn't block on:
//       - assertRelinkDoesNotResetCooldown pins round 1 defect 1's own regression: the ORIGINAL
//         vulnerability this migration's redesign closed (cooldown state living in a row the
//         pilot-id-change trigger deletes) had no assertion proving the fix holds. Reuses
//         assertPilotIdChangeInvalidatesVerification's own relink, immediately after, and asserts
//         the cooldown is still RL001-rejected rather than reset.
//       - assertProfileVerificationIssuanceHasNoClientGrants mirrors
//         assertTruncateIsClosedForClientRoles/assertAnonHasNoSelectGrantAtAll's grant-catalog
//         proof, but for profile_verification_issuance itself, via a new sibling RPC
//         (profile_verification_issuance_privilege_grants(), added to the same migration for the
//         same PostgREST-can't-see-information_schema reason profile_verifications' own RPC
//         exists) — confirms anon/authenticated hold zero privileges on the table, any level.
//       - assertCooldownAllowsReissueAfterWindow is the OTHER direction of round 6's
//         assertServiceRoleIssueWithinCooldownIsRateLimited: a re-issue past the 60-second window
//         must succeed and rotate the stored hash, not just that a re-issue inside the window is
//         rejected. Simulates the window passing via a direct admin-client UPDATE of
//         last_issued_at rather than sleeping 60+ seconds in a test run.
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
const REISSUED_CODE = 'PV172REISSUE'

// Must match the migration's own hashing exactly (encode(sha256(convert_to(code, 'utf8')),
// 'hex')) — same algorithm, same lowercase-hex encoding, so a hash computed here and one computed
// by Postgres for the same plaintext are byte-for-byte identical. Used to independently check the
// hash issue_pilot_verification actually persisted (assertServiceRoleIssuesVerificationForLinkedUser)
// and to seed the EXPIRED code case directly via the admin client (seedExpiredCode, which needs an
// already-expired otp_expires_at — a timestamp issue_pilot_verification itself always computes as
// in the future, so there is no RPC path that produces one).
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
//
// Also clears profile_verification_issuance, not just profile_verifications/profiles: that table
// has `on delete cascade` off auth.users, so a clean run's own cleanupFixtures (which deletes the
// fixture auth users) already clears it — but deleteFixtureUsers logs and swallows a failed
// deleteUser rather than throwing (see its own doc comment), so a prior run that hit that path
// could leave the fixture auth user, and its issuance row, behind. Without this explicit clear, a
// leftover last_issued_at from a previous run's own assertServiceRoleIssuesVerificationForLinkedUser
// could make THIS run's first issuance call spuriously hit RL001 if re-run within 60 seconds.
async function clearFixtureRows(ownerId: string, otherId: string): Promise<void> {
  const ids = [ownerId, otherId]
  const { error: issuanceError } = await adminClient.from('profile_verification_issuance').delete().in('user_id', ids)
  if (issuanceError) throw new Error(`failed to clear fixture profile_verification_issuance rows: ${issuanceError.message}`)

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
// needing a real session. Still no UNLINKED fixture user needed: round 5's
// assertServiceRoleIssueWithoutLinkedPilotIdFails covers the "no linked profile" business path
// with a bare random uuid instead (see that function's own doc comment) — the function under
// test only ever looks up target_user_id in profiles, it never needs target_user_id to be a real
// auth.users row to hit that lookup's "not found" branch, so provisioning a whole extra fixture
// user (sign-in, cleanup) for it would be pure overhead.
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

type PrivilegeGrantRow = { source: 'table' | 'column'; grantee: string; privilege_type: string; column_name: string | null }

// Reads supabase/migrations/20260813000000_create_profile_verifications.sql's own
// profile_verifications_privilege_grants() RPC (service_role-only) — the only way this script
// can see this table's actual grant catalog at all: PostgREST does not expose information_schema
// (or any system/catalog schema) over REST, for any role, so there is no `.schema(...)` call that
// would ever reach it directly. See that function's own doc comment for the full reasoning.
async function fetchPrivilegeGrants(): Promise<PrivilegeGrantRow[]> {
  const { data, error } = await adminClient.rpc('profile_verifications_privilege_grants')
  if (error) throw new Error(`failed to read profile_verifications' own privilege grants via the service_role-only RPC: ${error.message}`)
  return (data ?? []) as PrivilegeGrantRow[]
}

// Same reasoning as fetchPrivilegeGrants above, for issue #181's own new table: PostgREST doesn't
// expose information_schema for any role, so profile_verification_issuance's grant catalog is
// only reachable through its own service_role-only RPC
// (20260813030000_rate_limit_issue_pilot_verification.sql's
// profile_verification_issuance_privilege_grants(), added specifically for this).
async function fetchProfileVerificationIssuanceGrants(): Promise<PrivilegeGrantRow[]> {
  const { data, error } = await adminClient.rpc('profile_verification_issuance_privilege_grants')
  if (error) throw new Error(`failed to read profile_verification_issuance' own privilege grants via the service_role-only RPC: ${error.message}`)
  return (data ?? []) as PrivilegeGrantRow[]
}

// PostgREST has no TRUNCATE verb, so unlike INSERT/UPDATE/DELETE below (each probed by actually
// attempting them and checking for a privilege-denied error), there is no live request this
// script could ever send to prove TRUNCATE is closed — this migration's own round-3/round-4
// revoke had zero assertion coverage in either direction until now. Reads the grant catalog
// directly instead via fetchPrivilegeGrants.
function assertTruncateIsClosedForClientRoles(grants: PrivilegeGrantRow[]): void {
  const truncateGrantees = grants.filter((g) => g.privilege_type === 'TRUNCATE').map((g) => g.grantee)
  report(!truncateGrantees.includes('anon'), `negative: anon holds no TRUNCATE grant on profile_verifications (grantees seen with TRUNCATE: ${JSON.stringify(truncateGrantees)})`)
  report(!truncateGrantees.includes('authenticated'), `negative: authenticated holds no TRUNCATE grant on profile_verifications (grantees seen with TRUNCATE: ${JSON.stringify(truncateGrantees)})`)
}

// Round 5 pin: this migration's column-level SELECT revoke previously named only
// `authenticated`, an inconsistency with the INSERT/UPDATE/DELETE/TRUNCATE revoke just above it
// (which round 4 already widened to both roles for the same reason). Not a live leak either way —
// the row-level policy is `to authenticated` only, so anon already saw 0 rows regardless of what
// column-level SELECT privilege it held — but nothing previously pinned that, so a future change
// to the row-level policy could have quietly turned it into one. Checks anon holds NO
// column-level SELECT grant at all here, not just that otp_code_hash specifically is excluded.
function assertAnonHasNoSelectGrantAtAll(grants: PrivilegeGrantRow[]): void {
  const anonSelectColumns = grants.filter((g) => g.grantee === 'anon' && g.privilege_type === 'SELECT').map((g) => g.column_name)
  report(anonSelectColumns.length === 0, `negative: anon holds no column-level SELECT grant on profile_verifications at all, including otp_code_hash (columns seen: ${JSON.stringify(anonSelectColumns)})`)
}

// Round 2's should-fix, round 3's coverage: profile_verification_issuance's own migration
// (20260813030000_rate_limit_issue_pilot_verification.sql) revokes all privileges from
// public/anon/authenticated up front and grants no policies in either direction — this is the
// grant-catalog proof that revoke actually stuck, the same way assertTruncateIsClosedForClientRoles
// and assertAnonHasNoSelectGrantAtAll pin profile_verifications' own revokes above. Unlike those
// two (which each check one specific privilege/role combination this table already had prior
// coverage gaps for), this checks the client roles hold NO privilege at all on this table — table
// or column level, any of SELECT/INSERT/UPDATE/DELETE/TRUNCATE — since nothing about this table
// is ever meant to be client-reachable in the first place.
function assertProfileVerificationIssuanceHasNoClientGrants(grants: PrivilegeGrantRow[]): void {
  const clientGrants = grants.filter((g) => g.grantee === 'anon' || g.grantee === 'authenticated')
  report(
    clientGrants.length === 0,
    `negative: profile_verification_issuance grants zero privileges to anon/authenticated, table or column level (grants seen: ${JSON.stringify(clientGrants)})`,
  )
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

async function callIssue(
  client: SupabaseClient,
  targetUserId: string,
  scrapedEmail: string,
  code: string,
): Promise<{ error: string | null; code_: string | null }> {
  const { error } = await client.rpc('issue_pilot_verification', { target_user_id: targetUserId, scraped_email: scrapedEmail, code })
  return { error: error?.message ?? null, code_: error?.code ?? null }
}

// THE critical fix round 4 proves closed, re-verified unaffected by round 5's signature change:
// round 3 granted issue_pilot_verification's EXECUTE to `authenticated`, which let any signed-in
// user call it directly with a code of their own choosing (then immediately confirm that same
// code) — no email ever sent. Round 4 revokes that grant entirely. The owner's own real,
// correctly-linked session must be denied outright, at the privilege layer, before the function
// body (and its `code`/`target_user_id` arguments) is ever reached — exactly the same
// 42501-before-RLS shape assertDirectInsertIsPrivilegeDenied et al. already establish for the
// table's own INSERT/UPDATE/DELETE grants above. Passing ownerId as target_user_id here (rather
// than some other, arbitrary uuid) deliberately proves the denial isn't merely "this specific
// argument value is rejected" — even a caller targeting THEMSELVES is denied, because the grant
// check happens before any argument, including target_user_id, is ever inspected.
async function assertOwnerCannotIssueVerificationDirectly(ownerClient: SupabaseClient, ownerId: string): Promise<void> {
  const { error, code_ } = await callIssue(ownerClient, ownerId, OWNER_SCRAPED_EMAIL, 'ATTACKER-CHOSEN-CODE')
  report(error !== null, `negative: the owner's own authenticated session calling issue_pilot_verification directly was rejected (error: ${error ?? 'none — BUG'})`)
  report(code_ === '42501', `negative: the rejection is a table-level privilege denial (42501), raised before the function body (and its caller-supplied arguments) is ever reached (code seen: ${code_ ?? 'none'})`)

  const { data: rows, error: readError } = await adminClient.from('profile_verifications').select('user_id').eq('user_id', ownerId)
  if (readError) throw new Error(`failed to read back owner rows via admin client: ${readError.message}`)
  report((rows ?? []).length === 0, `negative: no row was created by the denied direct call (rows seen: ${JSON.stringify(rows)})`)
}

// THE genuine positive control round 4's assertServiceRoleReachesIssueVerificationBody was
// missing: round 4's version could only ever prove service_role's call reached the function
// body, never that a call could actually SUCCEED, because auth.uid() was always null under
// service_role — every call hit the "no linked pilot id" exception regardless of whether a real
// linked profile existed, so this "positive control" would have stayed green even under round
// 4's dead end (see the migration's own doc comment history for how that was measured). Now that
// `target_user_id` gives the function an identity that doesn't come from auth.uid() at all, this
// asserts a REAL end-to-end success: service_role, a target_user_id with an actual linked
// profiles.flightlog_pilot_id (OWNER_PILOT_ID, seeded by seedProfiles), and the correct resulting
// row — hash, expiry, pilot_id, and email all read back and checked, not just "no error".
//
// Doubles as this script's own way of seeding the `pending` row the confirm_pilot_verification
// assertions below need: round 4 had to bypass the RPC entirely for that (seedPendingVerification,
// a direct admin-client table write) because the RPC could never succeed. Now that it can, seeding
// through the real path is both more realistic coverage and less code to maintain.
async function assertServiceRoleIssuesVerificationForLinkedUser(ownerId: string, code: string): Promise<void> {
  const { error, code_ } = await callIssue(adminClient, ownerId, OWNER_SCRAPED_EMAIL, code)
  report(error === null, `positive: service_role issuing a verification for a target_user_id WITH a linked pilot id succeeded (error: ${error ?? 'none'}, code: ${code_ ?? 'n/a'})`)

  const { data: row, error: readError } = await adminClient
    .from('profile_verifications')
    .select('status, otp_code_hash, otp_expires_at, flightlog_pilot_id, email')
    .eq('user_id', ownerId)
    .single()
  if (readError) throw new Error(`failed to read back the issued row via admin client: ${readError.message}`)

  report(row?.status === 'pending', `positive: the issued row's status is 'pending' (admin read: ${JSON.stringify(row)})`)
  report(row?.otp_code_hash === sha256Hex(code), `positive: the issued row's otp_code_hash matches sha256(code), computed the same way the migration does (admin read: ${JSON.stringify(row)})`)
  const expiresAtMs = row?.otp_expires_at ? new Date(row.otp_expires_at as string).getTime() : null
  report(
    expiresAtMs !== null && expiresAtMs > Date.now() && expiresAtMs <= Date.now() + 10 * 60 * 1000 + 5_000,
    `positive: the issued row's otp_expires_at is ~10 minutes from now, computed server-side rather than trusted from a caller-supplied timestamp (admin read: ${JSON.stringify(row)})`,
  )
  report(row?.flightlog_pilot_id === OWNER_PILOT_ID, `positive: the issued row's flightlog_pilot_id was derived from the target user's own profiles row, not caller-supplied (admin read: ${JSON.stringify(row)})`)
  report(row?.email === OWNER_SCRAPED_EMAIL, `positive: the issued row's email matches what was passed in (admin read: ${JSON.stringify(row)})`)
}

// Issue #181's cooldown, round-tripped through PostgREST for real:
// 20260813030000_rate_limit_issue_pilot_verification.sql gates re-issuance with an atomic
// `insert ... on conflict do update ... where` against a dedicated profile_verification_issuance
// table, raising RL001 when the WHERE clause finds no row affected. Called immediately after
// assertServiceRoleIssuesVerificationForLinkedUser's own successful issuance for `ownerId`
// (reused as call #1, well inside the 60-second window), so this only needs to make call #2 and
// check it's rejected — plus that the rejection didn't silently overwrite the first call's row,
// proving the whole second transaction (including the profile_verifications write further down
// the function body) rolled back, not just the cooldown table's own upsert.
async function assertServiceRoleIssueWithinCooldownIsRateLimited(ownerId: string): Promise<void> {
  const { error, code_ } = await callIssue(adminClient, ownerId, OWNER_SCRAPED_EMAIL, 'SHOULD-NOT-PERSIST')
  report(error !== null, `negative: re-issuing for the same user inside the 60-second cooldown was rejected (error: ${error ?? 'none — BUG'})`)
  report(code_ === 'RL001', `negative: the cooldown rejection round-trips through PostgREST as error.code === 'RL001' (code seen: ${code_ ?? 'none'})`)

  const { data: row, error: readError } = await adminClient
    .from('profile_verifications')
    .select('otp_code_hash')
    .eq('user_id', ownerId)
    .single()
  if (readError) throw new Error(`failed to read back owner row via admin client: ${readError.message}`)
  report(
    row?.otp_code_hash === sha256Hex(CORRECT_CODE),
    `negative: the rate-limited re-issuance did not overwrite the prior call's persisted code hash (admin read: ${JSON.stringify(row)})`,
  )
}

// Round 2's should-fix, round 3's coverage: the OTHER direction of the cooldown, that a re-issue
// past the 60-second window succeeds and rotates the stored code, not just that a re-issue WITHIN
// the window is rejected (assertServiceRoleIssueWithinCooldownIsRateLimited above only proves the
// latter). Simulates the window passing via a direct admin-client UPDATE of
// profile_verification_issuance.last_issued_at to 61 seconds in the past, rather than actually
// sleeping 60+ seconds in a test run — adminClient has no RLS/grant restriction on this table to
// route around (see this table's own zero-client-grants posture), so this is a legitimate
// fixture-seeding move, not a workaround for something the app itself could ever do.
async function forceIssuanceCooldownExpired(ownerId: string): Promise<void> {
  const { error } = await adminClient
    .from('profile_verification_issuance')
    .update({ last_issued_at: new Date(Date.now() - 61_000).toISOString() })
    .eq('user_id', ownerId)
  if (error) throw new Error(`failed to force-expire the fixture cooldown window: ${error.message}`)
}

async function assertCooldownAllowsReissueAfterWindow(ownerId: string): Promise<void> {
  await forceIssuanceCooldownExpired(ownerId)

  const { error, code_ } = await callIssue(adminClient, ownerId, OWNER_SCRAPED_EMAIL, REISSUED_CODE)
  report(error === null, `positive: re-issuing once the 60-second cooldown window has passed succeeded (error: ${error ?? 'none'}, code: ${code_ ?? 'n/a'})`)

  const { data: row, error: readError } = await adminClient
    .from('profile_verifications')
    .select('otp_code_hash')
    .eq('user_id', ownerId)
    .single()
  if (readError) throw new Error(`failed to read back owner row via admin client: ${readError.message}`)
  report(
    row?.otp_code_hash === sha256Hex(REISSUED_CODE),
    `positive: the re-issued row's otp_code_hash rotated to match the new code once the cooldown window had passed (admin read: ${JSON.stringify(row)})`,
  )
}

// THE negative case round 4's version could never distinguish from a bug: a target_user_id with
// genuinely no linked profiles row must still raise P0001 ("no flightlog pilot id linked to the
// target profile"), but now for the right reason (an actual failed lookup) rather than the
// accidental one (auth.uid() being null no matter what). A bare random uuid is enough — the
// function only ever looks target_user_id up in profiles, it never needs target_user_id to
// reference a real auth.users row to hit that lookup's "not found" branch, so this needs no
// fixture user (sign-in, cleanup) of its own.
async function assertServiceRoleIssueWithoutLinkedPilotIdFails(): Promise<void> {
  const unlinkedUserId = randomUUID()
  const { error, code_ } = await callIssue(adminClient, unlinkedUserId, 'unlinked-probe@example.test', 'IRRELEVANT-CODE')
  report(error !== null, `negative: service_role issuing a verification for a target_user_id with NO linked pilot id was rejected (error: ${error ?? 'none — BUG'})`)
  report(code_ === 'P0001', `negative: the rejection is the function's own raised exception (P0001), for a target user id that genuinely has no profiles row, not a privilege denial (code seen: ${code_ ?? 'none'})`)

  const { data: rows, error: readError } = await adminClient.from('profile_verifications').select('user_id').eq('user_id', unlinkedUserId)
  if (readError) throw new Error(`failed to read back rows for the unlinked probe id via admin client: ${readError.message}`)
  report((rows ?? []).length === 0, `negative: no row was created for the unlinked target_user_id (rows seen: ${JSON.stringify(rows)})`)
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

// Round 1 defect 1's own regression pin: the ORIGINAL vulnerability this migration's rewrite
// closed was the cooldown living on profile_verifications.otp_issued_at, a row
// invalidate_profile_verification_on_pilot_change deletes on every pilot-id change — so relinking
// away and back reset the cooldown every time (six issuances/six emails in under a second,
// measured live). The redesign moved cooldown state to profile_verification_issuance, a table the
// trigger has no reason to ever touch, but nothing before now actually asserted that holds:
// re-uses assertPilotIdChangeInvalidatesVerification's own just-completed relink (still well
// inside the 60-second window from assertServiceRoleIssuesVerificationForLinkedUser's original
// issuance) and asserts an immediate re-issue attempt is STILL rejected with RL001, not a fresh
// success.
async function assertRelinkDoesNotResetCooldown(ownerId: string): Promise<void> {
  const { error, code_ } = await callIssue(adminClient, ownerId, OWNER_SCRAPED_EMAIL, 'SHOULD-NOT-PERSIST-AFTER-RELINK')
  report(error !== null, `negative: re-issuing immediately after a pilot-id relink was still rejected (error: ${error ?? 'none — BUG'})`)
  report(code_ === 'RL001', `negative: the relink did NOT reset the cooldown — the rejection is still RL001, not a fresh success (code seen: ${code_ ?? 'none'})`)
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
await checkProfileVerificationIssuanceTableExists(adminClient)

const { userId: ownerId, emailOtp: ownerEmailOtp } = await resolveTestUser(OWNER_EMAIL)
const { userId: otherId, emailOtp: otherEmailOtp } = await resolveTestUser(OTHER_EMAIL)

try {
  // Idempotent re-run safety: clear anything a previous (possibly aborted) run left behind
  // before seeding.
  await clearFixtureRows(ownerId, otherId)
  await seedProfiles(ownerId, otherId)

  const ownerClient = await signInAsUser(OWNER_EMAIL, ownerEmailOtp)
  const otherClient = await signInAsUser(OTHER_EMAIL, otherEmailOtp)

  const privilegeGrants = await fetchPrivilegeGrants()
  assertTruncateIsClosedForClientRoles(privilegeGrants)
  assertAnonHasNoSelectGrantAtAll(privilegeGrants)

  const issuanceGrants = await fetchProfileVerificationIssuanceGrants()
  assertProfileVerificationIssuanceHasNoClientGrants(issuanceGrants)

  await assertDirectInsertIsPrivilegeDenied(ownerClient, ownerId)
  await assertDirectUpdateIsPrivilegeDenied(ownerClient, ownerId)
  await assertDirectDeleteIsPrivilegeDenied(ownerClient, ownerId)

  await assertOwnerCannotIssueVerificationDirectly(ownerClient, ownerId)
  await assertServiceRoleIssueWithoutLinkedPilotIdFails()
  await assertServiceRoleIssuesVerificationForLinkedUser(ownerId, CORRECT_CODE)
  await assertServiceRoleIssueWithinCooldownIsRateLimited(ownerId)

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
  await assertRelinkDoesNotResetCooldown(ownerId)
  await assertUnrelatedProfileUpdateDoesNotInvalidate(ownerClient, ownerId)
  await assertCooldownAllowsReissueAfterWindow(ownerId)
} finally {
  await cleanupFixtures(ownerId, otherId)
}

finish('profile_verifications privilege lock-down, issue_pilot_verification, confirm_pilot_verification, and the pilot-id-change trigger verification')
