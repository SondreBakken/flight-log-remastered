import type { SupabaseClient } from '@supabase/supabase-js'
import { getFollowersForPilot } from '../src/lib/follows/get-followers-for-pilot'
import { getCommentsForTripIds } from '../src/lib/comments/get-comments-for-trip-ids'

let failures = 0

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'ok' : 'FAIL'} - ${label}`)
  if (!pass) {
    failures++
    console.error(`  expected: ${JSON.stringify(expected)}`)
    console.error(`  actual:   ${JSON.stringify(actual)}`)
  }
}

function assert(condition: boolean, label: string): void {
  console.log(`${condition ? 'ok' : 'FAIL'} - ${label}`)
  if (!condition) failures++
}

// --- Fake Supabase client ---
//
// getFollowersForPilot/getCommentsForTripIds both take an injected SupabaseClient (see their own
// doc comments) specifically so this script can drive them against a hand-built fake instead of
// a live database — same reasoning and shape as scripts/check-comments.mts's own fake: a plain
// object implementing just the chain each function actually calls (from/select/eq/in/order),
// matching how the real postgrest-js builder resolves.
//
// This fake has NO row-visibility engine at all — it returns every row a query's own filters
// match, unconditionally. It cannot exercise the new
// supabase/migrations/20260812000000_add_follows_select_for_own_pilot.sql RLS policy (whether an
// unrelated visitor is actually blocked from reading someone else's followers) — that needs a
// live database or Supabase Studio's own policy simulator, once that migration is actually
// applied, which is out of scope for this script.

type FakeFollowRow = { user_id: string; pilot_id: number; created_at: string }
type FakeCommentRow = { id: string; user_id: string; trip_id: number; body: string; created_at: string }
type FakeProfileRow = { user_id: string; display_name: string | null }

function makeFakeSupabase(seed: { follows?: FakeFollowRow[]; comments?: FakeCommentRow[]; profiles?: FakeProfileRow[] } = {}) {
  const followRows = [...(seed.follows ?? [])]
  const commentRows = [...(seed.comments ?? [])]
  const profileRows = [...(seed.profiles ?? [])]

  let followsQueryCalls = 0
  let commentsQueryCalls = 0
  let profilesQueryCalls = 0
  let forcedFollowsError: { message: string } | null = null
  let forcedCommentsError: { message: string } | null = null
  let forcedProfilesError: { message: string } | null = null

  const client = {
    from(table: string) {
      if (table === 'follows') {
        return {
          select() {
            let pilotIdFilter: number | null = null
            const query = {
              eq(column: string, value: unknown) {
                if (column === 'pilot_id') pilotIdFilter = value as number
                return query
              },
              then(resolve: (result: { data: FakeFollowRow[] | null; error: { message: string } | null }) => void) {
                followsQueryCalls++
                if (forcedFollowsError) {
                  resolve({ data: null, error: forcedFollowsError })
                  return
                }
                const matching = followRows.filter((row) => pilotIdFilter === null || row.pilot_id === pilotIdFilter)
                resolve({ data: matching, error: null })
              },
            }
            return query
          },
        }
      }
      if (table === 'comments') {
        return {
          select() {
            let tripIdFilter: number[] | null = null
            let ascending = true
            const query = {
              in(column: string, values: unknown) {
                if (column === 'trip_id') tripIdFilter = values as number[]
                return query
              },
              order(_column: string, options: { ascending: boolean }) {
                ascending = options.ascending
                return query
              },
              then(resolve: (result: { data: FakeCommentRow[] | null; error: { message: string } | null }) => void) {
                commentsQueryCalls++
                if (forcedCommentsError) {
                  resolve({ data: null, error: forcedCommentsError })
                  return
                }
                const matching = commentRows.filter((row) => tripIdFilter === null || tripIdFilter.includes(row.trip_id))
                const sorted = [...matching].sort((a, b) => {
                  if (a.created_at === b.created_at) return 0
                  const cmp = a.created_at < b.created_at ? -1 : 1
                  return ascending ? cmp : -cmp
                })
                resolve({ data: sorted, error: null })
              },
            }
            return query
          },
        }
      }
      if (table === 'profiles') {
        return {
          select() {
            let userIdFilter: string[] | null = null
            const query = {
              in(column: string, values: unknown) {
                if (column === 'user_id') userIdFilter = values as string[]
                return query
              },
              then(resolve: (result: { data: FakeProfileRow[] | null; error: { message: string } | null }) => void) {
                profilesQueryCalls++
                if (forcedProfilesError) {
                  resolve({ data: null, error: forcedProfilesError })
                  return
                }
                const matching = profileRows.filter((row) => userIdFilter === null || userIdFilter.includes(row.user_id))
                resolve({ data: matching, error: null })
              },
            }
            return query
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }

  return {
    client: client as unknown as SupabaseClient,
    forceFollowsError(message: string): void {
      forcedFollowsError = { message }
    },
    forceCommentsError(message: string): void {
      forcedCommentsError = { message }
    },
    forceProfilesError(message: string): void {
      forcedProfilesError = { message }
    },
    get followsQueryCalls() {
      return followsQueryCalls
    },
    get commentsQueryCalls() {
      return commentsQueryCalls
    },
    get profilesQueryCalls() {
      return profilesQueryCalls
    },
  }
}

// --- getFollowersForPilot ---

{
  const fake = makeFakeSupabase({
    follows: [
      { user_id: 'user-a', pilot_id: 12677, created_at: '2026-01-01T00:00:00.000Z' },
      { user_id: 'user-b', pilot_id: 12677, created_at: '2026-01-02T00:00:00.000Z' },
      { user_id: 'user-c', pilot_id: 99999, created_at: '2026-01-03T00:00:00.000Z' },
    ],
    profiles: [{ user_id: 'user-a', display_name: 'Alex' }],
  })
  const followers = await getFollowersForPilot(fake.client, 12677)
  assertEqual(
    followers,
    [
      { userId: 'user-a', createdAt: '2026-01-01T00:00:00.000Z', displayName: 'Alex' },
      { userId: 'user-b', createdAt: '2026-01-02T00:00:00.000Z', displayName: null },
    ],
    'getFollowersForPilot returns only followers of the given pilot id, each with a joined display name, falling back to null for an author with no profile row',
  )
  assertEqual(fake.profilesQueryCalls, 1, 'getFollowersForPilot issues exactly one profiles query for the whole page, not one per follower')
}

{
  const fake = makeFakeSupabase({ follows: [{ user_id: 'user-a', pilot_id: 99999, created_at: '2026-01-01T00:00:00.000Z' }] })
  const followers = await getFollowersForPilot(fake.client, 12677)
  assertEqual(followers, [], 'a pilot id with no followers returns an empty list')
}

{
  const fake = makeFakeSupabase()
  fake.forceFollowsError('connection refused')
  const followers = await getFollowersForPilot(fake.client, 12677)
  assertEqual(followers, [], 'getFollowersForPilot returns an empty list, not a thrown exception, when the query fails')
}

// --- getCommentsForTripIds ---

{
  const fake = makeFakeSupabase({
    comments: [
      { id: '1', user_id: 'user-a', trip_id: 10, body: 'nice flight', created_at: '2026-01-01T00:00:00.000Z' },
      { id: '2', user_id: 'user-b', trip_id: 20, body: 'great distance', created_at: '2026-01-02T00:00:00.000Z' },
      { id: '3', user_id: 'user-a', trip_id: 30, body: 'unrelated flight', created_at: '2026-01-03T00:00:00.000Z' },
    ],
    profiles: [{ user_id: 'user-a', display_name: 'Alex' }],
  })
  const comments = await getCommentsForTripIds(fake.client, [10, 20])
  assertEqual(
    comments,
    [
      { id: '1', tripId: 10, userId: 'user-a', body: 'nice flight', createdAt: '2026-01-01T00:00:00.000Z', displayName: 'Alex' },
      { id: '2', tripId: 20, userId: 'user-b', body: 'great distance', createdAt: '2026-01-02T00:00:00.000Z', displayName: null },
    ],
    'getCommentsForTripIds returns only comments on the given trip ids, oldest first, each with a joined display name',
  )
  assertEqual(fake.profilesQueryCalls, 1, 'getCommentsForTripIds issues exactly one profiles query for the whole page, not one per comment')
}

{
  const fake = makeFakeSupabase({ comments: [{ id: '1', user_id: 'user-a', trip_id: 10, body: 'hi', created_at: '2026-01-01T00:00:00.000Z' }] })
  const comments = await getCommentsForTripIds(fake.client, [])
  assertEqual(comments, [], 'getCommentsForTripIds short-circuits to an empty list without querying, given no trip ids')
  assert(fake.commentsQueryCalls === 0, 'an empty tripIds list never issues a comments query')
  assert(fake.profilesQueryCalls === 0, 'an empty tripIds list never issues a profiles query either, since there are no authors to look up')
}

{
  const fake = makeFakeSupabase()
  fake.forceCommentsError('connection refused')
  const comments = await getCommentsForTripIds(fake.client, [10])
  assertEqual(comments, [], 'getCommentsForTripIds returns an empty list, not a thrown exception, when the query fails')
}

{
  const fake = makeFakeSupabase({
    comments: [{ id: '1', user_id: 'user-a', trip_id: 10, body: 'hi', created_at: '2026-01-01T00:00:00.000Z' }],
  })
  fake.forceProfilesError('connection refused')
  const comments = await getCommentsForTripIds(fake.client, [10])
  assertEqual(
    comments,
    [{ id: '1', tripId: 10, userId: 'user-a', body: 'hi', createdAt: '2026-01-01T00:00:00.000Z', displayName: null }],
    'a failed profiles query degrades every comment to displayName: null rather than failing the whole page',
  )
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
