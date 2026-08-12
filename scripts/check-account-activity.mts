import type { SupabaseClient } from '@supabase/supabase-js'
import { getFollowersForPilot } from '../src/lib/follows/get-followers-for-pilot'
import { getCommentsForTripIds } from '../src/lib/comments/get-comments-for-trip-ids'
import { assertRejects } from './lib/assert'

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

// Projects a row down to exactly the columns a `.select('a, b, c')` call asked for, mirroring
// PostgREST's own column-list behavior. Without this, dropping (or narrowing) a select's column
// list in the real implementation would still return full rows here and pass green — a select
// mistake is otherwise invisible to this fake.
function project<T extends Record<string, unknown>>(row: T, columns: string): T {
  const keys = columns.split(',').map((column) => column.trim())
  const picked = {} as Record<string, unknown>
  for (const key of keys) picked[key] = row[key]
  return picked as T
}

// Sorts by created_at only when `.order()` was actually called on the chain, same as PostgREST
// only sorts when a query explicitly asks for it. Without the `orderCalled` guard, this fake used
// to sort unconditionally (defaulting to ascending), which meant deleting a real `.order(...)`
// call from application code still passed the check green.
function sortByCreatedAt<T extends { created_at: string }>(rows: T[], orderCalled: boolean, ascending: boolean): T[] {
  if (!orderCalled) return rows
  return [...rows].sort((a, b) => {
    if (a.created_at === b.created_at) return 0
    const cmp = a.created_at < b.created_at ? -1 : 1
    return ascending ? cmp : -cmp
  })
}

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
          select(columns: string) {
            let pilotIdFilter: number | null = null
            let ascending = true
            let orderCalled = false
            const query = {
              eq(column: string, value: unknown) {
                if (column === 'pilot_id') pilotIdFilter = value as number
                return query
              },
              order(_column: string, options: { ascending: boolean }) {
                ascending = options.ascending
                orderCalled = true
                return query
              },
              then(resolve: (result: { data: FakeFollowRow[] | null; error: { message: string } | null }) => void) {
                followsQueryCalls++
                if (forcedFollowsError) {
                  resolve({ data: null, error: forcedFollowsError })
                  return
                }
                const matching = followRows.filter((row) => pilotIdFilter === null || row.pilot_id === pilotIdFilter)
                const ordered = sortByCreatedAt(matching, orderCalled, ascending)
                resolve({ data: ordered.map((row) => project(row, columns)), error: null })
              },
            }
            return query
          },
        }
      }
      if (table === 'comments') {
        return {
          select(columns: string) {
            let tripIdFilter: number[] | null = null
            let ascending = true
            let orderCalled = false
            const query = {
              in(column: string, values: unknown) {
                if (column === 'trip_id') tripIdFilter = values as number[]
                return query
              },
              order(_column: string, options: { ascending: boolean }) {
                ascending = options.ascending
                orderCalled = true
                return query
              },
              then(resolve: (result: { data: FakeCommentRow[] | null; error: { message: string } | null }) => void) {
                commentsQueryCalls++
                if (forcedCommentsError) {
                  resolve({ data: null, error: forcedCommentsError })
                  return
                }
                const matching = commentRows.filter((row) => tripIdFilter === null || tripIdFilter.includes(row.trip_id))
                const ordered = sortByCreatedAt(matching, orderCalled, ascending)
                resolve({ data: ordered.map((row) => project(row, columns)), error: null })
              },
            }
            return query
          },
        }
      }
      if (table === 'profiles') {
        return {
          select(columns: string) {
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
                resolve({ data: matching.map((row) => project(row, columns)), error: null })
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
      { userId: 'user-b', createdAt: '2026-01-02T00:00:00.000Z', displayName: null },
      { userId: 'user-a', createdAt: '2026-01-01T00:00:00.000Z', displayName: 'Alex' },
    ],
    'getFollowersForPilot returns only followers of the given pilot id, newest first, each with a joined display name, falling back to null for an author with no profile row',
  )
  assertEqual(fake.profilesQueryCalls, 1, 'getFollowersForPilot issues exactly one profiles query for the whole page, not one per follower')
}

{
  const fake = makeFakeSupabase({ follows: [{ user_id: 'user-a', pilot_id: 99999, created_at: '2026-01-01T00:00:00.000Z' }] })
  const followers = await getFollowersForPilot(fake.client, 12677)
  assertEqual(followers, [], 'a pilot id with no followers returns an empty list')
}

// #155: see getFollowersForPilot's own doc comment for why a query error throws rather than
// degrading to []. The throw is caught by account-activity/index.tsx's SectionErrorBoundary,
// which is out of this script's own reach (it drives getFollowersForPilot directly, not the
// React tree around it).
{
  const fake = makeFakeSupabase()
  fake.forceFollowsError('connection refused')
  await assertRejects(
    assert,
    () => getFollowersForPilot(fake.client, 12677),
    'getFollowersForPilot throws, distinguishably from an empty list, when the query fails',
  )
}

// Mutation guard: seeded oldest-to-newest (insertion order already ascending), so this only
// passes if getFollowersForPilot's own `.order('created_at', { ascending: false })` call is what
// produces the newest-first result — dropping that call would leave the fake's rows in their
// unsorted (ascending) insertion order and fail this assertion, since the fake now only sorts
// when `.order()` is actually invoked on the chain (see sortByCreatedAt/orderCalled above).
{
  const fake = makeFakeSupabase({
    follows: [
      { user_id: 'user-oldest', pilot_id: 12677, created_at: '2026-01-01T00:00:00.000Z' },
      { user_id: 'user-middle', pilot_id: 12677, created_at: '2026-01-02T00:00:00.000Z' },
      { user_id: 'user-newest', pilot_id: 12677, created_at: '2026-01-03T00:00:00.000Z' },
    ],
  })
  const followers = await getFollowersForPilot(fake.client, 12677)
  assertEqual(
    followers.map((follower) => follower.userId),
    ['user-newest', 'user-middle', 'user-oldest'],
    'getFollowersForPilot mutation guard: newest-first ordering actually comes from the query, not from seed order',
  )
}

// Mutation guard: dropping a column from getFollowersForPilot's own select() list (e.g.
// `created_at`) would leave it undefined here, since the fake now actually projects rows down to
// the requested columns instead of returning full rows regardless of what was selected.
{
  const fake = makeFakeSupabase({
    follows: [{ user_id: 'user-a', pilot_id: 12677, created_at: '2026-01-01T00:00:00.000Z' }],
  })
  const followers = await getFollowersForPilot(fake.client, 12677)
  assert(
    followers[0]?.createdAt === '2026-01-01T00:00:00.000Z',
    "getFollowersForPilot mutation guard: createdAt is populated from the select's own columns, not left undefined by a narrowed select",
  )
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
      { id: '2', tripId: 20, userId: 'user-b', body: 'great distance', createdAt: '2026-01-02T00:00:00.000Z', displayName: null },
      { id: '1', tripId: 10, userId: 'user-a', body: 'nice flight', createdAt: '2026-01-01T00:00:00.000Z', displayName: 'Alex' },
    ],
    'getCommentsForTripIds returns only comments on the given trip ids, newest first, each with a joined display name',
  )
  assertEqual(fake.profilesQueryCalls, 1, 'getCommentsForTripIds issues exactly one profiles query for the whole page, not one per comment')
}

// Mutation guard: seeded oldest-to-newest (insertion order already ascending), so this only
// passes if getCommentsForTripIds's own `.order('created_at', { ascending: false })` call is what
// produces the newest-first result — same reasoning as getFollowersForPilot's own mutation guard
// above.
{
  const fake = makeFakeSupabase({
    comments: [
      { id: 'oldest', user_id: 'user-a', trip_id: 10, body: 'first', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'middle', user_id: 'user-a', trip_id: 10, body: 'second', created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'newest', user_id: 'user-a', trip_id: 10, body: 'third', created_at: '2026-01-03T00:00:00.000Z' },
    ],
  })
  const comments = await getCommentsForTripIds(fake.client, [10])
  assertEqual(
    comments.map((comment) => comment.id),
    ['newest', 'middle', 'oldest'],
    'getCommentsForTripIds mutation guard: newest-first ordering actually comes from the query, not from seed order',
  )
}

// Mutation guard: dropping a column from getCommentsForTripIds's own select() list (e.g.
// `trip_id`) would leave tripId undefined here, since the fake now actually projects rows down to
// the requested columns instead of returning full rows regardless of what was selected.
{
  const fake = makeFakeSupabase({
    comments: [{ id: '1', user_id: 'user-a', trip_id: 10, body: 'hi', created_at: '2026-01-01T00:00:00.000Z' }],
  })
  const comments = await getCommentsForTripIds(fake.client, [10])
  assert(
    comments[0]?.tripId === 10,
    "getCommentsForTripIds mutation guard: tripId is populated from the select's own columns, not left undefined by a narrowed select",
  )
}

{
  const fake = makeFakeSupabase({ comments: [{ id: '1', user_id: 'user-a', trip_id: 10, body: 'hi', created_at: '2026-01-01T00:00:00.000Z' }] })
  const comments = await getCommentsForTripIds(fake.client, [])
  assertEqual(comments, [], 'getCommentsForTripIds short-circuits to an empty list without querying, given no trip ids')
  assert(fake.commentsQueryCalls === 0, 'an empty tripIds list never issues a comments query')
  assert(fake.profilesQueryCalls === 0, 'an empty tripIds list never issues a profiles query either, since there are no authors to look up')
}

// #159: see getCommentsForTripIds's own doc comment for why a query error throws rather than
// degrading to [] — same shape #155 established for getFollowersForPilot above. The throw is
// caught by account-activity/index.tsx's own SectionErrorBoundary, out of this script's reach
// (it drives getCommentsForTripIds directly, not the React tree around it).
{
  const fake = makeFakeSupabase()
  fake.forceCommentsError('connection refused')
  await assertRejects(
    assert,
    () => getCommentsForTripIds(fake.client, [10]),
    'getCommentsForTripIds throws, distinguishably from an empty list, when the query fails',
  )
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
