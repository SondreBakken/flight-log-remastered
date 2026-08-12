import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { checkFollowsTableExists } from './lib/check-follows-table'
import { createReporter } from './lib/verify-report'
import { createAdminClient } from '../src/lib/supabase/admin'
import { requireSupabaseEnv } from '../src/lib/supabase/env'

// Proves supabase/migrations/20260812000000_add_follows_select_for_own_pilot.sql's additive
// SELECT policy is actually enforced on the live project (issue #148), the way verify-feed.mts
// proves the feed's behavior: against a REAL authenticated Supabase session, not a stubbed
// client. Unlike verify-feed.mts this needs no browser at all — the thing under test is a
// PostgREST-level RLS policy, not rendered UI, so this is a pure Node script that signs a
// synthetic user in via @supabase/supabase-js directly (createClient + auth.verifyOtp) and reads
// `follows` back through that client's own session. This client is created with
// `persistSession: false` (see signInAsViewer) — that setting is what makes @supabase/auth-js's
// GoTrueClient hold the session in a plain in-memory adapter instead of ever touching storage, not
// an automatic Node fallback (there's no environment detection branch here; the same config would
// pick the same adapter in a browser). The session verifyOtp sets lives for the lifetime of this
// one client instance, which is exactly long enough for this script's three read-back queries
// below.
//
// `follows`' 3 original policies (supabase/migrations/20260810020000_create_follows.sql) are all
// scoped to `auth.uid() = user_id` — a user can read their own OUTGOING follows. The policy this
// proves adds a second, additive permissive SELECT policy: `pilot_id in (select
// flightlog_pilot_id from profiles WHERE user_id = auth.uid())`. Postgres ORs multiple permissive
// policies for the same command together, so three fixture rows and three assertions are needed
// to actually pin the OR, not just "RLS returns something":
//   1. incoming (own pilot id): a row this user did NOT create, following the VIEWER's own
//      linked pilot id — visible only via the new pilot-ownership clause.
//   2. mis-scope guard: a row following a DIFFERENT pilot id, one linked to OTHER's own profile
//      (not the viewer's) — this is the row that would incorrectly leak if the new policy's
//      `where user_id = auth.uid()` were ever dropped (e.g. `select flightlog_pilot_id from
//      profiles` with no WHERE at all), since OTHER_PILOT_ID would then be in the unscoped set of
//      every profile's linked pilot id, not just the viewer's own. Without OTHER also having a
//      profile row claiming this pilot id, a mis-scoped policy would still (accidentally)
//      correctly hide it, defeating the point of this assertion — see seedFixtures.
//   3. owner-scoped survival: the viewer's own OUTGOING follow (a row where user_id = viewer,
//      pilot_id = someone else's) — visible only via the pre-existing auth.uid() = user_id
//      policy. Proves that policy wasn't dropped or replaced by the migration this script
//      targets, which is additive by design (see the migration's own doc comment).
//
// Two dedicated fixture identities, distinct from verify-feed.mts's verify-feed-script@example.test,
// per this issue's scout plan — reusing that email would let two scripts race to seed/clear the
// same auth.users row on concurrent runs.
//
// Run with:
//   pnpm exec tsx --env-file=.env.local --conditions=react-server scripts/verify-follows-select-policy.mts
// (see verify-feed.mts's own header comment for why both flags are required: --env-file loads
// this script's own Node process's Supabase credentials, --conditions=react-server is required
// because src/lib/supabase/admin.ts imports 'server-only'.)

const VIEWER_EMAIL = 'verify-follows-select-policy-viewer@example.test'
const OTHER_EMAIL = 'verify-follows-select-policy-other@example.test'

// Obviously-fake sentinel pilot ids tied to this issue, same convention as verify-feed.mts's
// FAILING_PILOT_ID=555555: flightlog_pilot_id has no FK/check constraint (it's a self-declared,
// unverified external id, see 20260811010000_add_flightlog_pilot_id_to_profiles.sql), so any
// integer works and there is no real pilot to collide with.
const VIEWER_PILOT_ID = 900148
const OTHER_PILOT_ID = 900149

const { report, finish } = createReporter()
const adminClient = createAdminClient()

// Distinguishes "flightlog_pilot_id column missing" (setup problem: the migration this script
// needs to seed a profile row isn't applied) from "the SELECT policy migration this script
// actually tests isn't applied" (the genuine finding this script exists to surface) — same
// 42703 reasoning as get-flightlog-pilot-ids.ts. Fails on ANY error, not just 42703, for the same
// reason checkFollowsTableExists does: a bad credential or network failure must not pass this
// guard silently.
async function checkFlightlogPilotIdColumnExists(adminClient: SupabaseClient): Promise<void> {
  const { error } = await adminClient.from('profiles').select('flightlog_pilot_id').limit(1)
  if (!error) return

  if (error.code === '42703') {
    console.error(
      'the `flightlog_pilot_id` column does not exist on `profiles` — apply migration 20260811010000_add_flightlog_pilot_id_to_profiles.sql before running this script.',
    )
  } else {
    console.error(`precondition check failed querying \`profiles.flightlog_pilot_id\`: [${error.code ?? 'no code'}] ${error.message}`)
  }
  process.exit(1)
}

// generateLink provisions the auth.users row on first call and mints a single-use OTP alongside
// it, returning the same existing user (with a fresh OTP) on any later call for the same email.
// deleteFixtureUsers removes both fixture identities at the end of every run (see the finally
// block below), so this is normally a fresh row each time — but generateLink's idempotency means
// a leftover user from an aborted prior run (a mid-run crash, or a swallowed deleteFixtureUsers
// error) is picked up and reused safely instead of colliding.
async function resolveTestUser(email: string): Promise<{ userId: string; emailOtp: string }> {
  const { data, error } = await adminClient.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data.user?.id || !data.properties?.email_otp) {
    console.error(`could not provision fixture user ${email} via generateLink: ${error?.message ?? 'no user/email_otp returned'}`)
    process.exit(1)
  }
  return { userId: data.user.id, emailOtp: data.properties.email_otp }
}

// Deletes only rows this script itself could have seeded (scoped to the two fixture user ids),
// never a broader sweep of either table — safe to call before AND after the run, so an aborted
// previous run never poisons this one. Throws on a delete error rather than swallowing it (same
// convention as verify-feed.mts's seedFollowedPilots) — a cleanup failure left silent here would
// otherwise surface next run as a confusing, misattributed duplicate-key seed failure instead of
// the actual cleanup problem.
async function clearFixtureRows(viewerId: string, otherId: string): Promise<void> {
  const { error: followsError } = await adminClient.from('follows').delete().in('user_id', [viewerId, otherId])
  if (followsError) throw new Error(`failed to clear fixture follows rows: ${followsError.message}`)

  const { error: profilesError } = await adminClient.from('profiles').delete().in('user_id', [viewerId, otherId])
  if (profilesError) throw new Error(`failed to clear fixture profiles rows: ${profilesError.message}`)
}

// Never throws: called from the finally block below, where an exception here would replace
// (mask) whatever exception the try block was already propagating. GoTrueAdminApi's deleteUser
// can itself throw for some non-auth errors (not just return { error }), so each call is wrapped
// individually — one fixture user's deletion failing must not skip the other's.
async function deleteFixtureUsers(viewerId: string, otherId: string): Promise<void> {
  for (const id of [viewerId, otherId]) {
    try {
      const { error } = await adminClient.auth.admin.deleteUser(id)
      if (error) console.error(`cleanup: failed to delete fixture auth user ${id}: ${error.message}`)
    } catch (err) {
      console.error(`cleanup: deleteUser threw for fixture auth user ${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// Runs both cleanup steps from the finally block specifically: clearFixtureRows can throw (by
// design, see its own doc comment), but a cleanup failure here must never replace the original
// error the try block was already propagating — so it's caught and logged, not rethrown.
// deleteFixtureUsers already never throws (see its own doc comment), but is still sequenced after
// so a failed row cleanup doesn't skip user cleanup entirely.
async function cleanupFixtures(viewerId: string, otherId: string): Promise<void> {
  try {
    await clearFixtureRows(viewerId, otherId)
  } catch (err) {
    console.error(`cleanup: failed to clear fixture rows: ${err instanceof Error ? err.message : String(err)}`)
  }
  await deleteFixtureUsers(viewerId, otherId)
}

// Seeds two profiles rows and three follows rows — see the module doc comment above for what
// each of the three follows rows is actually pinning. OTHER also gets a profiles row (not just
// the viewer) specifically so the mis-scope-guard row has a claimant: without it, OTHER_PILOT_ID
// would be linked to NO profile at all, and a policy that accidentally dropped its
// `where user_id = auth.uid()` clause would still (accidentally) hide row 2, defeating the point
// of that assertion.
async function seedFixtures(viewerId: string, otherId: string): Promise<void> {
  const { error: profileError } = await adminClient.from('profiles').upsert(
    [
      { user_id: viewerId, flightlog_pilot_id: VIEWER_PILOT_ID },
      { user_id: otherId, flightlog_pilot_id: OTHER_PILOT_ID },
    ],
    { onConflict: 'user_id' },
  )
  if (profileError) throw new Error(`failed to seed fixture profiles: ${profileError.message}`)

  const { error: followsError } = await adminClient.from('follows').insert([
    { user_id: otherId, pilot_id: VIEWER_PILOT_ID }, // 1. incoming: visible only via the new pilot-ownership policy
    { user_id: otherId, pilot_id: OTHER_PILOT_ID }, // 2. mis-scope guard: would leak under a policy missing its own-profile scoping
    { user_id: viewerId, pilot_id: OTHER_PILOT_ID }, // 3. outgoing: visible only via the pre-existing owner-scoped policy
  ])
  if (followsError) throw new Error(`failed to seed follows fixtures: ${followsError.message}`)
}

// Confirms, via the RLS-bypassing admin client, that every seeded row genuinely exists before any
// assertion runs through the viewer's own session — without this, a seed that silently inserted
// zero rows would make a "not visible" assertion below pass vacuously (nothing to see because
// nothing was ever there, not because RLS hid it).
async function confirmFixturesSeeded(viewerId: string, otherId: string): Promise<void> {
  const { data: profileRows, error: profileError } = await adminClient
    .from('profiles')
    .select('user_id, flightlog_pilot_id')
    .in('user_id', [viewerId, otherId])
  if (profileError) throw new Error(`failed to confirm seeded profiles fixtures via admin client: ${profileError.message}`)
  const seededPilotIdByUser = new Map((profileRows ?? []).map((row) => [row.user_id as string, row.flightlog_pilot_id as number | null]))
  report(seededPilotIdByUser.get(viewerId) === VIEWER_PILOT_ID, "setup: the admin client confirms the viewer's profile links their own pilot id")
  report(seededPilotIdByUser.get(otherId) === OTHER_PILOT_ID, "setup: the admin client confirms OTHER's profile links the mis-scope-guard pilot id")

  const { data: followsRows, error: followsError } = await adminClient.from('follows').select('user_id, pilot_id').in('user_id', [viewerId, otherId])
  if (followsError) throw new Error(`failed to confirm seeded follows fixtures via admin client: ${followsError.message}`)
  const seeded = new Set((followsRows ?? []).map((row) => `${row.user_id}:${row.pilot_id}`))
  report(seeded.has(`${otherId}:${VIEWER_PILOT_ID}`), 'setup: the admin client confirms the incoming own-pilot follow row was actually inserted')
  report(seeded.has(`${otherId}:${OTHER_PILOT_ID}`), 'setup: the admin client confirms the mis-scope-guard follow row was actually inserted')
  report(seeded.has(`${viewerId}:${OTHER_PILOT_ID}`), "setup: the admin client confirms the viewer's own outgoing follow row was actually inserted")
}

// Signs the viewer in for real via @supabase/supabase-js's own auth.verifyOtp — the plain-Node
// equivalent of verify-feed.mts's browser-side signInAsTestUser, minus the browser: nothing here
// depends on cookies or a page context, only the client's own in-memory session. Throws (rather
// than process.exit) on failure so the caller's finally block still runs cleanup — exiting here
// directly would leak every fixture row and both fixture auth users on the live project.
async function signInAsViewer(emailOtp: string): Promise<SupabaseClient> {
  const { url, anonKey } = requireSupabaseEnv()
  const viewerClient: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data, error } = await viewerClient.auth.verifyOtp({ email: VIEWER_EMAIL, token: emailOtp, type: 'email' })
  report(error === null, `sign-in: verifyOtp for the viewer fixture succeeded (${error ? error.message : 'no error'})`)
  report(data.session !== null, 'sign-in: verifyOtp returned a real session for the viewer fixture')
  if (error || !data.session) {
    throw new Error(`sign-in failed for the viewer fixture: ${error ? error.message : 'verifyOtp returned no session'}`)
  }
  return viewerClient
}

async function assertIncomingOwnPilotFollowIsVisible(viewerClient: SupabaseClient, otherId: string): Promise<void> {
  const { data, error } = await viewerClient.from('follows').select('user_id, pilot_id').eq('pilot_id', VIEWER_PILOT_ID).eq('user_id', otherId)

  // An error here is a distinct failure from "no rows" — treating it as "not visible" would
  // conflate a genuine RLS-deny with a broken query, so it gets its own loud, separately labeled
  // report instead of being folded into the row-count assertion below.
  report(error === null, `positive: reading the own-pilot incoming follow through the viewer's session did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(
    error === null && rows.length === 1 && rows[0]?.pilot_id === VIEWER_PILOT_ID && rows[0]?.user_id === otherId,
    `positive: the follow row targeting the viewer's own pilot id (${VIEWER_PILOT_ID}) IS visible through the viewer's own session (rows seen: ${JSON.stringify(rows)})`,
  )
}

async function assertMisscopedGuardFollowIsHidden(viewerClient: SupabaseClient, otherId: string): Promise<void> {
  // Rows 2 and 3 (seedFixtures) both target OTHER_PILOT_ID — the .eq('user_id', otherId) filter
  // below is what tells them apart, not the pilot_id filter alone. Do NOT simplify this to a
  // pilot_id-only filter to "align" with production's getFollowersForPilot (which legitimately
  // filters by pilot_id alone, see src/lib/follows/get-followers-for-pilot.ts): here that would
  // also match row 3 (the viewer's OWN outgoing follow to the same pilot id, visible via the
  // pre-existing owner-scoped policy), silently turning this negative assertion into a false pass.
  const { data, error } = await viewerClient.from('follows').select('user_id, pilot_id').eq('pilot_id', OTHER_PILOT_ID).eq('user_id', otherId)

  report(error === null, `negative: reading the mis-scope-guard follow through the viewer's session did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  // error === null is folded into this report too — otherwise a query that errored out would log
  // "ok" here purely because rows.length happens to be 0, misrepresenting an RLS-deny as the
  // cause when the real cause was a broken query. The sibling error report just above already
  // turns the run red either way, but this line's own label must not lie about why.
  report(
    error === null && rows.length === 0,
    `negative: the follow row targeting a DIFFERENT pilot id (${OTHER_PILOT_ID}), one that WOULD leak under a policy missing its own-profile scoping, is NOT visible through the viewer's session (rows seen: ${JSON.stringify(rows)})`,
  )
}

async function assertOwnOutgoingFollowIsVisible(viewerClient: SupabaseClient, viewerId: string): Promise<void> {
  const { data, error } = await viewerClient.from('follows').select('user_id, pilot_id').eq('pilot_id', OTHER_PILOT_ID).eq('user_id', viewerId)

  report(error === null, `owner-scoped: reading the viewer's own outgoing follow through their own session did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(
    error === null && rows.length === 1 && rows[0]?.pilot_id === OTHER_PILOT_ID && rows[0]?.user_id === viewerId,
    `owner-scoped: the viewer's own outgoing follow (user_id = viewer) IS visible through their own session, proving the pre-existing auth.uid() = user_id policy was not dropped or replaced (rows seen: ${JSON.stringify(rows)})`,
  )
}

await checkFollowsTableExists(adminClient)
await checkFlightlogPilotIdColumnExists(adminClient)

const { userId: viewerId, emailOtp } = await resolveTestUser(VIEWER_EMAIL)
const { userId: otherId } = await resolveTestUser(OTHER_EMAIL)

try {
  // Idempotent re-run safety: clear anything a previous (possibly aborted) run left behind
  // before seeding, same reasoning as verify-feed.mts's pre-scenario-1 cleanup.
  await clearFixtureRows(viewerId, otherId)
  await seedFixtures(viewerId, otherId)
  await confirmFixturesSeeded(viewerId, otherId)

  const viewerClient = await signInAsViewer(emailOtp)
  await assertIncomingOwnPilotFollowIsVisible(viewerClient, otherId)
  await assertMisscopedGuardFollowIsHidden(viewerClient, otherId)
  await assertOwnOutgoingFollowIsVisible(viewerClient, viewerId)
} finally {
  await cleanupFixtures(viewerId, otherId)
}

finish('follows SELECT policy (own-pilot grant present, correctly scoped, pre-existing owner grant intact) verification')
