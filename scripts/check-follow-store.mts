import type { SupabaseClient } from '@supabase/supabase-js'
import { followPilot } from '../src/lib/follows/follow-pilot'
import { unfollowPilot } from '../src/lib/follows/unfollow-pilot'
import { getFollowedPilotIds } from '../src/lib/follows/get-followed-pilot-ids'

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

function idsOf(ids: Set<number>): number[] {
  return [...ids].sort((a, b) => a - b)
}

// --- Fake Supabase client ---
//
// followPilot/unfollowPilot/getFollowedPilotIds all take an injected SupabaseClient (see their
// own doc comments) specifically so this script can drive them against a hand-built fake
// instead of a live database — same reasoning and shape as scripts/check-comments.mts's own
// fake. asUser models which session this fake client belongs to, independent of whatever
// userId a test passes into followPilot/unfollowPilot's own input: the real `follows` table's
// RLS policies (supabase/migrations/20260810020000_create_follows.sql) derive auth.uid() from
// the caller's own session, never from a client-supplied value, so this fake's insert/delete
// only ever act as sessionUserId, exactly like the real database would enforce.

type FakeFollowRow = { user_id: string; pilot_id: number }

function makeFakeSupabase(seedRows: FakeFollowRow[] = [], options?: { asUser?: string }) {
  const rows: FakeFollowRow[] = [...seedRows]
  const sessionUserId = options?.asUser ?? null
  let forcedSelectError: { message: string } | null = null
  let forcedInsertError: { code?: string; message: string } | null = null
  let forcedDeleteError: { message: string } | null = null

  function makeSelectQuery() {
    let userIdFilter: string | null = null
    let pilotIdFilter: number[] | null = null

    const query = {
      eq(column: string, value: unknown) {
        if (column === 'user_id') userIdFilter = value as string
        return query
      },
      in(column: string, values: unknown) {
        if (column === 'pilot_id') pilotIdFilter = values as number[]
        return query
      },
      then(resolve: (result: { data: FakeFollowRow[] | null; error: { message: string } | null }) => void) {
        if (forcedSelectError) {
          resolve({ data: null, error: forcedSelectError })
          return
        }
        const matching = rows.filter(
          (row) =>
            (userIdFilter === null || row.user_id === userIdFilter) &&
            (pilotIdFilter === null || pilotIdFilter.includes(row.pilot_id)),
        )
        resolve({ data: matching, error: null })
      },
    }
    return query
  }

  const client = {
    from(table: string) {
      if (table !== 'follows') throw new Error(`unexpected table: ${table}`)
      return {
        select() {
          return makeSelectQuery()
        },
        // The real insert is gated by the RLS "users can follow as themselves" policy
        // (`with check (auth.uid() = user_id)`) — this fake models that same enforcement by
        // inserting under sessionUserId, ignoring whatever user_id the row argument claims.
        insert(row: { user_id: string; pilot_id: number }) {
          return {
            then(resolve: (result: { error: { code?: string; message: string } | null }) => void) {
              if (forcedInsertError) {
                resolve({ error: forcedInsertError })
                return
              }
              if (rows.some((existing) => existing.user_id === sessionUserId && existing.pilot_id === row.pilot_id)) {
                resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
                return
              }
              rows.push({ user_id: sessionUserId ?? row.user_id, pilot_id: row.pilot_id })
              resolve({ error: null })
            },
          }
        },
        delete() {
          let pilotIdFilter: number | null = null
          const builder = {
            eq(column: string, value: unknown) {
              if (column === 'pilot_id') pilotIdFilter = value as number
              return builder
            },
            then(resolve: (result: { error: { message: string } | null }) => void) {
              if (forcedDeleteError) {
                resolve({ error: forcedDeleteError })
                return
              }
              // Mirrors the "users can unfollow their own follows" RLS policy
              // (`using (auth.uid() = user_id)`): only sessionUserId's own row for this
              // pilot_id is ever removed, regardless of what the caller might have claimed.
              const index = rows.findIndex((row) => row.user_id === sessionUserId && row.pilot_id === pilotIdFilter)
              if (index !== -1) rows.splice(index, 1)
              resolve({ error: null })
            },
          }
          return builder
        },
      }
    },
  }

  return {
    client: client as unknown as SupabaseClient,
    rows,
    forceSelectError(message: string): void {
      forcedSelectError = { message }
    },
    forceInsertError(message: string): void {
      forcedInsertError = { message }
    },
    forceDeleteError(message: string): void {
      forcedDeleteError = { message }
    },
  }
}

// --- followPilot ---

{
  const fake = makeFakeSupabase([], { asUser: 'user-a' })
  const result = await followPilot(fake.client, { userId: 'user-a', pilotId: 4549 })
  assertEqual(result, { kind: 'followed' }, 'following a new pilot succeeds')
  assertEqual(fake.rows, [{ user_id: 'user-a', pilot_id: 4549 }], 'the follow row is inserted under the session user, for the given pilot')
}

{
  const fake = makeFakeSupabase([{ user_id: 'user-a', pilot_id: 4549 }], { asUser: 'user-a' })
  const result = await followPilot(fake.client, { userId: 'user-a', pilotId: 4549 })
  assertEqual(result, { kind: 'followed' }, 'following an already-followed pilot is a no-op success, not an error')
  assertEqual(fake.rows.length, 1, 'no duplicate row is inserted')
}

{
  const fake = makeFakeSupabase()
  fake.forceInsertError('connection refused')
  const result = await followPilot(fake.client, { userId: 'user-a', pilotId: 4549 })
  assertEqual(result, { kind: 'db-error', message: 'failed to follow this pilot' }, 'a genuine (non-duplicate-key) insert failure surfaces as db-error, not a thrown exception')
}

// --- unfollowPilot ---

{
  const fake = makeFakeSupabase([{ user_id: 'user-a', pilot_id: 4549 }], { asUser: 'user-a' })
  const result = await unfollowPilot(fake.client, { userId: 'user-a', pilotId: 4549 })
  assertEqual(result, { kind: 'unfollowed' }, 'unfollowing a followed pilot succeeds')
  assertEqual(fake.rows, [], 'the follow row is removed')
}

{
  const fake = makeFakeSupabase([], { asUser: 'user-a' })
  const result = await unfollowPilot(fake.client, { userId: 'user-a', pilotId: 4549 })
  assertEqual(result, { kind: 'unfollowed' }, 'unfollowing a pilot that was never followed is a no-op success, not an error')
}

// A non-author cannot unfollow someone else's row, same as an RLS rejection would behave. The
// fake's session (asUser) is 'user-b', and the input passed to unfollowPilot claims userId
// 'user-a' anyway, an attacker-controlled value pretending to be the follower — unfollowPilot
// never reads that claim (see its own doc comment): only the session's real identity decides
// which row a delete can touch, same as against a live database's RLS policy.
{
  const fake = makeFakeSupabase([{ user_id: 'user-a', pilot_id: 4549 }], { asUser: 'user-b' })
  const result = await unfollowPilot(fake.client, { userId: 'user-a', pilotId: 4549 })
  assertEqual(result, { kind: 'unfollowed' }, "a non-follower's unfollow call still reports success (nothing of theirs to remove)")
  assertEqual(fake.rows, [{ user_id: 'user-a', pilot_id: 4549 }], "the actual follower's row is left untouched when a different session attempts to remove it")
}

{
  const fake = makeFakeSupabase([{ user_id: 'user-a', pilot_id: 4549 }], { asUser: 'user-a' })
  fake.forceDeleteError('connection refused')
  const result = await unfollowPilot(fake.client, { userId: 'user-a', pilotId: 4549 })
  assertEqual(result, { kind: 'db-error', message: 'failed to unfollow this pilot' }, 'a failed delete surfaces as db-error, not a thrown exception')
}

// --- getFollowedPilotIds ---

{
  const fake = makeFakeSupabase([
    { user_id: 'user-a', pilot_id: 1 },
    { user_id: 'user-a', pilot_id: 2 },
    { user_id: 'user-b', pilot_id: 3 },
  ])
  const ids = await getFollowedPilotIds(fake.client, 'user-a')
  assertEqual(idsOf(ids), [1, 2], 'omitting candidatePilotIds returns every pilot the given user follows, scoped to that user only')
}

{
  const fake = makeFakeSupabase([
    { user_id: 'user-a', pilot_id: 1 },
    { user_id: 'user-a', pilot_id: 2 },
    { user_id: 'user-a', pilot_id: 3 },
  ])
  const ids = await getFollowedPilotIds(fake.client, 'user-a', [2, 3, 999])
  assertEqual(idsOf(ids), [2, 3], 'a candidate list narrows the result to the intersection of followed and candidate ids')
}

{
  const fake = makeFakeSupabase([{ user_id: 'user-a', pilot_id: 1 }])
  const ids = await getFollowedPilotIds(fake.client, 'user-a', [])
  assertEqual(idsOf(ids), [], 'an empty candidate list short-circuits to an empty result without querying at all')
}

// #155: a follows query error now throws rather than degrading to an empty Set — a denied or
// misconfigured RLS policy used to be indistinguishable from "follows nobody". The throw is
// caught by resolve-viewer-follow-state.ts, this function's one real caller, which turns it into
// an explicit followsUnavailable signal instead — out of this script's reach, since it drives
// getFollowedPilotIds directly.
{
  const fake = makeFakeSupabase()
  fake.forceSelectError('connection refused')
  let threw = false
  try {
    await getFollowedPilotIds(fake.client, 'user-a')
  } catch {
    threw = true
  }
  assertEqual(threw, true, 'getFollowedPilotIds throws, distinguishably from an empty set, when the query fails')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
