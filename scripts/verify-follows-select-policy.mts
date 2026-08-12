import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createReporter } from './lib/verify-report'
import { createAdminClient } from '../src/lib/supabase/admin'
import { requireSupabaseEnv } from '../src/lib/supabase/env'

// Proves supabase/migrations/20260812000000_add_follows_select_for_own_pilot.sql's additive
// SELECT policy is actually enforced on the live project (issue #148), the way verify-feed.mts
// proves the feed's behavior: against a REAL authenticated Supabase session, not a stubbed
// client. Unlike verify-feed.mts this needs no browser at all — the thing under test is a
// PostgREST-level RLS policy, not rendered UI, so this is a pure Node script that signs a
// synthetic user in via @supabase/supabase-js directly (createClient + auth.verifyOtp) and reads
// `follows` back through that client's own session. In Node, supabase-js has no window/
// localStorage to persist a session into and falls back to an in-memory storage adapter
// (@supabase/auth-js's GoTrueClient constructor); the session set by verifyOtp lives for the
// lifetime of this one client instance, which is exactly long enough for this script's two
// read-back queries below.
//
// `follows`' 3 original policies (supabase/migrations/20260810020000_create_follows.sql) are all
// scoped to `auth.uid() = user_id` — a user can read their own OUTGOING follows. The new policy
// this proves adds a second, additive permissive SELECT policy: `pilot_id in (select
// flightlog_pilot_id from profiles where user_id = auth.uid())`. Postgres ORs multiple
// permissive policies for the same command together, so this is a proof of the OR, not just
// "RLS returns something": the positive assertion below seeds a follow row this user did NOT
// create (following someone ELSE's pilot id), so it can only be visible through the new
// pilot-ownership clause, never the pre-existing follower-ownership one. The negative assertion
// seeds a row that matches NEITHER clause, to rule out "RLS is disabled entirely" as the reason
// the positive row was visible.
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

// Same reasoning as verify-feed.mts's checkFollowsTableExists: fail loud and early on a
// not-yet-applied migration instead of letting every assertion below fail confusingly.
async function checkFollowsTableExists(): Promise<void> {
  const { error } = await adminClient.from('follows').select('user_id').limit(1)
  if (error?.code === '42P01') {
    console.error('the `follows` table does not exist in this Supabase project — apply supabase/migrations before running this script.')
    process.exit(1)
  }
}

// Distinguishes "flightlog_pilot_id column missing" (setup problem: the migration this script
// needs to seed a profile row isn't applied) from "the SELECT policy migration this script
// actually tests isn't applied" (the genuine finding this script exists to surface) — same
// 42703 reasoning as get-flightlog-pilot-ids.ts.
async function checkFlightlogPilotIdColumnExists(): Promise<void> {
  const { error } = await adminClient.from('profiles').select('flightlog_pilot_id').limit(1)
  if (error?.code === '42703') {
    console.error(
      'the `flightlog_pilot_id` column does not exist on `profiles` — apply migration 20260811010000_add_flightlog_pilot_id_to_profiles.sql before running this script.',
    )
    process.exit(1)
  }
}

// generateLink provisions the auth.users row on first call and returns the same one on every
// later call for this email (see verify-feed.mts's resolveTestUser) — doubles as "resolve this
// fixture's user id" and "mint this run's sign-in OTP".
async function resolveTestUser(email: string): Promise<{ userId: string; emailOtp: string }> {
  const { data, error } = await adminClient.auth.admin.generateLink({ type: 'magiclink', email })
  if (error || !data.user?.id || !data.properties?.email_otp) {
    console.error(`could not provision fixture user ${email} via generateLink: ${error?.message ?? 'no user/email_otp returned'}`)
    process.exit(1)
  }
  return { userId: data.user.id, emailOtp: data.properties.email_otp }
}

// Deletes only rows this script itself could have seeded (scoped to the two fixture user ids and
// the two sentinel pilot ids), never a broader sweep of the table — safe to call before AND
// after the run, so an aborted previous run never poisons this one.
async function clearFixtureRows(viewerId: string, otherId: string): Promise<void> {
  await adminClient.from('follows').delete().in('user_id', [viewerId, otherId])
  await adminClient.from('profiles').delete().eq('user_id', viewerId)
}

async function deleteFixtureUsers(viewerId: string, otherId: string): Promise<void> {
  for (const id of [viewerId, otherId]) {
    const { error } = await adminClient.auth.admin.deleteUser(id)
    if (error) console.error(`cleanup: failed to delete fixture auth user ${id}: ${error.message}`)
  }
}

// Seeds the viewer's self-declared pilot link, and two follow rows the viewer did not create
// themselves: one targeting the viewer's own pilot id (should become visible through the new
// policy), one targeting a different pilot id (should stay invisible). Both rows are owned by
// `otherId` as follower so neither could ever be explained by the pre-existing
// auth.uid() = user_id policy alone.
async function seedFixtures(viewerId: string, otherId: string): Promise<void> {
  const { error: profileError } = await adminClient
    .from('profiles')
    .upsert({ user_id: viewerId, flightlog_pilot_id: VIEWER_PILOT_ID }, { onConflict: 'user_id' })
  if (profileError) throw new Error(`failed to seed viewer profile: ${profileError.message}`)

  const { error: followsError } = await adminClient.from('follows').insert([
    { user_id: otherId, pilot_id: VIEWER_PILOT_ID },
    { user_id: otherId, pilot_id: OTHER_PILOT_ID },
  ])
  if (followsError) throw new Error(`failed to seed follows fixtures: ${followsError.message}`)
}

// Confirms, via the RLS-bypassing admin client, that both seeded rows genuinely exist before any
// assertion runs through the viewer's own session — without this, a seed that silently inserted
// zero rows would make the negative assertion below pass vacuously (nothing to see because
// nothing was ever there, not because RLS hid it).
async function confirmFixturesSeeded(otherId: string): Promise<void> {
  const { data, error } = await adminClient.from('follows').select('pilot_id').eq('user_id', otherId).in('pilot_id', [VIEWER_PILOT_ID, OTHER_PILOT_ID])
  if (error) throw new Error(`failed to confirm seeded follows fixtures via admin client: ${error.message}`)
  const seededPilotIds = new Set((data ?? []).map((row) => row.pilot_id as number))
  report(seededPilotIds.has(VIEWER_PILOT_ID), 'setup: the admin client confirms the own-pilot follow row was actually inserted')
  report(seededPilotIds.has(OTHER_PILOT_ID), 'setup: the admin client confirms the different-pilot follow row was actually inserted')
}

// Signs the viewer in for real via @supabase/supabase-js's own auth.verifyOtp — the plain-Node
// equivalent of verify-feed.mts's browser-side signInAsTestUser, minus the browser: nothing here
// depends on cookies or a page context, only the client's own in-memory session.
async function signInAsViewer(emailOtp: string): Promise<SupabaseClient> {
  const { url, anonKey } = requireSupabaseEnv()
  const viewerClient: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data, error } = await viewerClient.auth.verifyOtp({ email: VIEWER_EMAIL, token: emailOtp, type: 'email' })
  report(error === null, `sign-in: verifyOtp for the viewer fixture succeeded (${error ? error.message : 'no error'})`)
  report(data.session !== null, 'sign-in: verifyOtp returned a real session for the viewer fixture')
  if (error || !data.session) {
    console.error('cannot continue without a real viewer session — aborting before the RLS assertions.')
    process.exit(1)
  }
  return viewerClient
}

async function assertOwnPilotFollowIsVisible(viewerClient: SupabaseClient, otherId: string): Promise<void> {
  const { data, error } = await viewerClient.from('follows').select('user_id, pilot_id').eq('pilot_id', VIEWER_PILOT_ID).eq('user_id', otherId)

  // An error here is a distinct failure from "no rows" — treating it as "not visible" would
  // conflate a genuine RLS-deny with a broken query, so it gets its own loud, separately labeled
  // report instead of being folded into the row-count assertion below.
  report(error === null, `positive: reading the own-pilot incoming follow through the viewer's session did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(
    rows.length === 1 && rows[0].pilot_id === VIEWER_PILOT_ID && rows[0].user_id === otherId,
    `positive: the follow row targeting the viewer's own pilot id (${VIEWER_PILOT_ID}) IS visible through the viewer's own session (rows seen: ${JSON.stringify(rows)})`,
  )
}

async function assertOtherPilotFollowIsHidden(viewerClient: SupabaseClient, otherId: string): Promise<void> {
  const { data, error } = await viewerClient.from('follows').select('user_id, pilot_id').eq('pilot_id', OTHER_PILOT_ID).eq('user_id', otherId)

  report(error === null, `negative: reading the different-pilot follow through the viewer's session did not error (${error ? error.message : 'ok'})`)
  const rows = data ?? []
  report(
    rows.length === 0,
    `negative: the follow row targeting a DIFFERENT pilot id (${OTHER_PILOT_ID}) is NOT visible through the viewer's session (rows seen: ${JSON.stringify(rows)})`,
  )
}

await checkFollowsTableExists()
await checkFlightlogPilotIdColumnExists()

const { userId: viewerId, emailOtp } = await resolveTestUser(VIEWER_EMAIL)
const { userId: otherId } = await resolveTestUser(OTHER_EMAIL)

try {
  // Idempotent re-run safety: clear anything a previous (possibly aborted) run left behind
  // before seeding, same reasoning as verify-feed.mts's pre-scenario-1 cleanup.
  await clearFixtureRows(viewerId, otherId)
  await seedFixtures(viewerId, otherId)
  await confirmFixturesSeeded(otherId)

  const viewerClient = await signInAsViewer(emailOtp)
  await assertOwnPilotFollowIsVisible(viewerClient, otherId)
  await assertOtherPilotFollowIsHidden(viewerClient, otherId)
} finally {
  await clearFixtureRows(viewerId, otherId)
  await deleteFixtureUsers(viewerId, otherId)
}

finish('follows SELECT policy (own-pilot incoming follows) verification')
