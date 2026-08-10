import type { SupabaseClient } from '@supabase/supabase-js'
import { postComment } from '../src/lib/comments/post-comment'
import { getComments } from '../src/lib/comments/get-comments'
import { deleteComment } from '../src/lib/comments/delete-comment'
import { commentFormStateFor } from '../src/features/comment-on-flight/comment-form-state'

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
// postComment and getComments both take an injected SupabaseClient (see their own doc
// comments) specifically so this script can drive them against a hand-built fake instead of a
// live database — the same reason src/app/auth/callback/route.test.ts mocks '@/lib/supabase/server'
// rather than hitting a real project. Not a vi.mock (this script runs under plain tsx, not
// Vitest): a plain object implementing just the chain postComment/getComments actually call
// (from/select/eq/gt/order, both ending as thenables), matching how the real postgrest-js
// builder resolves — cast through `unknown` at the boundary since this fake's shape is
// deliberately narrower than the real (heavily generic) SupabaseClient type.

type FakeCommentRow = {
  id: string
  user_id: string
  trip_id: number
  body: string
  created_at: string
  deleted_at?: string | null
}

type SelectOptions = { count?: 'exact'; head?: boolean }

// asUser models which session this fake client belongs to — the real soft_delete_own_comment
// RPC (supabase/migrations/20260810010000_..._policy.sql) derives auth.uid() from the caller's
// own session, not from any argument the RPC call passes in, so the fake needs its own notion
// of "who is this client authenticated as" independent of whatever userId a test passes into
// deleteComment's input.
function makeFakeSupabase(seedRows: FakeCommentRow[] = [], options?: { asUser?: string }) {
  const rows: FakeCommentRow[] = [...seedRows]
  const sessionUserId = options?.asUser ?? null
  let nextId = rows.length + 1
  let insertCalls = 0
  let rpcCalls = 0
  let countQueryCalls = 0
  let listQueryCalls = 0
  let forcedError: { message: string } | null = null
  let forcedInsertError: { message: string } | null = null
  let forcedRpcError: { message: string } | null = null

  function makeQuery(opts?: SelectOptions) {
    let tripIdFilter: number | null = null
    let userIdFilter: string | null = null
    let sinceFilter: string | null = null
    let ascending = true

    const query = {
      eq(column: string, value: unknown) {
        if (column === 'trip_id') tripIdFilter = value as number
        if (column === 'user_id') userIdFilter = value as string
        return query
      },
      gt(column: string, value: unknown) {
        if (column === 'created_at') sinceFilter = value as string
        return query
      },
      order(_column: string, options: { ascending: boolean }) {
        ascending = options.ascending
        return query
      },
      then(
        resolve: (result: { data: FakeCommentRow[] | null; count: number | null; error: { message: string } | null }) => void,
      ) {
        const isCountQuery = opts?.count === 'exact'
        if (isCountQuery) countQueryCalls++
        else listQueryCalls++

        if (forcedError) {
          resolve({ data: null, count: null, error: forcedError })
          return
        }

        // Mirrors the "comments are publicly readable when not deleted" RLS policy, which
        // applies to every select against this table regardless of caller — including
        // postComment's own rate-limit count query, not just getComments's list query.
        const matching = rows.filter(
          (row) =>
            !row.deleted_at &&
            (tripIdFilter === null || row.trip_id === tripIdFilter) &&
            (userIdFilter === null || row.user_id === userIdFilter) &&
            (sinceFilter === null || row.created_at > sinceFilter),
        )

        if (isCountQuery) {
          resolve({ data: null, count: matching.length, error: null })
          return
        }

        const sorted = [...matching].sort((a, b) => {
          if (a.created_at === b.created_at) return 0
          const cmp = a.created_at < b.created_at ? -1 : 1
          return ascending ? cmp : -cmp
        })
        resolve({ data: sorted, count: null, error: null })
      },
    }
    return query
  }

  const client = {
    from(table: string) {
      if (table !== 'comments') throw new Error(`unexpected table: ${table}`)
      return {
        select(_columns: string, opts?: SelectOptions) {
          return makeQuery(opts)
        },
        insert(row: { trip_id: number; user_id: string; body: string }) {
          return {
            then(resolve: (result: { error: { message: string } | null }) => void) {
              insertCalls++
              if (forcedInsertError) {
                resolve({ error: forcedInsertError })
                return
              }
              rows.push({
                id: `fake-${nextId++}`,
                user_id: row.user_id,
                trip_id: row.trip_id,
                body: row.body,
                created_at: new Date().toISOString(),
                deleted_at: null,
              })
              resolve({ error: null })
            },
          }
        },
      }
    },
    rpc(fnName: string, args: { comment_id: string }) {
      if (fnName !== 'soft_delete_own_comment') throw new Error(`unexpected rpc: ${fnName}`)
      return {
        then(resolve: (result: { data: boolean | null; error: { message: string } | null }) => void) {
          rpcCalls++
          if (forcedRpcError) {
            resolve({ data: null, error: forcedRpcError })
            return
          }

          // Mirrors soft_delete_own_comment's own body: `where id = comment_id and user_id =
          // auth.uid() and deleted_at is null`. auth.uid() is sessionUserId here, never a value
          // read off `args` — the RPC call itself only ever sends comment_id (see
          // delete-comment.ts), same as the real function never trusts a caller-supplied user id.
          const target = rows.find((row) => row.id === args.comment_id && row.user_id === sessionUserId && !row.deleted_at)
          if (!target) {
            resolve({ data: false, error: null })
            return
          }

          target.deleted_at = new Date().toISOString()
          resolve({ data: true, error: null })
        },
      }
    },
  }

  return {
    client: client as unknown as SupabaseClient,
    rows,
    forceError(message: string): void {
      forcedError = { message }
    },
    forceInsertError(message: string): void {
      forcedInsertError = { message }
    },
    forceRpcError(message: string): void {
      forcedRpcError = { message }
    },
    get insertCalls() {
      return insertCalls
    },
    get rpcCalls() {
      return rpcCalls
    },
    get countQueryCalls() {
      return countQueryCalls
    },
    get listQueryCalls() {
      return listQueryCalls
    },
  }
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

function recentRowsFor(userId: string, count: number, minutesOld = 0.1): FakeCommentRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `seed-${userId}-${index}`,
    user_id: userId,
    trip_id: 1,
    body: `seed comment ${index}`,
    created_at: minutesAgo(minutesOld),
  }))
}

// --- postComment: validation ---

{
  const fake = makeFakeSupabase()
  const result = await postComment(fake.client, { tripId: 1, userId: 'user-a', body: '   ' })
  assertEqual(result, { kind: 'empty-body' }, 'a blank (whitespace-only) body is rejected as empty-body')
  assert(fake.countQueryCalls === 0, 'an empty-body rejection never reaches the rate-limit check')
  assert(fake.insertCalls === 0, 'an empty-body rejection never inserts')
}

// --- postComment: rate limit ---

{
  const fake = makeFakeSupabase(recentRowsFor('user-a', 5))
  const result = await postComment(fake.client, { tripId: 1, userId: 'user-a', body: 'hello' })
  assertEqual(result, { kind: 'rate-limited' }, 'a 6th comment within the last minute (5 already posted) is rejected as rate-limited')
  assert(fake.insertCalls === 0, 'a rate-limited comment is never inserted')
}

{
  const fake = makeFakeSupabase(recentRowsFor('user-a', 4))
  const result = await postComment(fake.client, { tripId: 1, userId: 'user-a', body: 'hello' })
  assertEqual(result, { kind: 'posted' }, 'a 5th comment within the last minute (only 4 already posted) is allowed')
  assert(fake.insertCalls === 1, 'an allowed comment is inserted exactly once')
}

{
  // Comments older than the 1-minute window must not count toward the limit.
  const fake = makeFakeSupabase(recentRowsFor('user-a', 5, 5))
  const result = await postComment(fake.client, { tripId: 1, userId: 'user-a', body: 'hello' })
  assertEqual(result, { kind: 'posted' }, '5 comments older than 1 minute do not count toward the rate limit')
}

{
  // Another user's recent comments must not count toward this user's limit.
  const fake = makeFakeSupabase(recentRowsFor('user-b', 10))
  const result = await postComment(fake.client, { tripId: 1, userId: 'user-a', body: 'hello' })
  assertEqual(result, { kind: 'posted' }, "another user's recent comments do not count toward this user's rate limit")
}

// --- postComment: insert ---

{
  const fake = makeFakeSupabase()
  await postComment(fake.client, { tripId: 42, userId: 'user-a', body: '  padded body  ' })
  assertEqual(
    { tripId: fake.rows[0]?.trip_id, userId: fake.rows[0]?.user_id, body: fake.rows[0]?.body },
    { tripId: 42, userId: 'user-a', body: 'padded body' },
    'a posted comment is inserted with the given tripId/userId and a trimmed body',
  )
}

// --- postComment: db errors surface, don't throw ---

{
  const fake = makeFakeSupabase()
  fake.forceError('connection refused')
  const result = await postComment(fake.client, { tripId: 1, userId: 'user-a', body: 'hello' })
  assertEqual(result, { kind: 'db-error', message: 'failed to check the rate limit' }, 'a failed rate-limit query surfaces as db-error, not a thrown exception')
}

{
  const fake = makeFakeSupabase()
  fake.forceInsertError('constraint violation')
  const result = await postComment(fake.client, { tripId: 1, userId: 'user-a', body: 'hello' })
  assertEqual(result, { kind: 'db-error', message: 'failed to save the comment' }, 'a failed insert surfaces as db-error, not a thrown exception')
}

// --- getComments ---

{
  const fake = makeFakeSupabase([
    { id: '1', user_id: 'user-a', trip_id: 1, body: 'first', created_at: '2026-01-01T00:00:00.000Z' },
    { id: '2', user_id: 'user-b', trip_id: 1, body: 'second', created_at: '2026-01-02T00:00:00.000Z' },
    { id: '3', user_id: 'user-a', trip_id: 2, body: 'other flight', created_at: '2026-01-03T00:00:00.000Z' },
  ])
  const comments = await getComments(fake.client, 1)
  assertEqual(
    comments,
    [
      { id: '1', userId: 'user-a', body: 'first', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: '2', userId: 'user-b', body: 'second', createdAt: '2026-01-02T00:00:00.000Z' },
    ],
    'getComments returns only the given trip\'s comments, oldest first, mapped to camelCase',
  )
}

{
  const fake = makeFakeSupabase()
  fake.forceError('connection refused')
  const comments = await getComments(fake.client, 1)
  assertEqual(comments, [], 'getComments returns an empty list, not a thrown exception, when the query fails')
}

// --- deleteComment: an author deleting their own comment ---

{
  const fake = makeFakeSupabase(
    [{ id: '1', user_id: 'user-a', trip_id: 1, body: 'mine', created_at: '2026-01-01T00:00:00.000Z' }],
    { asUser: 'user-a' },
  )
  const result = await deleteComment(fake.client, { id: '1', userId: 'user-a' })
  assertEqual(result, { kind: 'deleted' }, 'an author soft-deleting their own comment succeeds')
  assert(typeof fake.rows[0]?.deleted_at === 'string' && fake.rows[0].deleted_at !== null, 'deleted_at is stamped with a timestamp, not left null')
}

// --- deleteComment: removes it from the public list for every viewer, without a manual reload ---
// (the "reload" itself is a Server Action concern — actions.test.ts asserts revalidatePath is
// called — this proves the data layer underneath it: once deleted_at is set, the same public
// read RLS policy that already filters it for everyone stops returning the row here too.)

{
  const fake = makeFakeSupabase(
    [
      { id: '1', user_id: 'user-a', trip_id: 1, body: 'mine', created_at: '2026-01-01T00:00:00.000Z' },
      { id: '2', user_id: 'user-b', trip_id: 1, body: 'someone else\'s', created_at: '2026-01-02T00:00:00.000Z' },
    ],
    { asUser: 'user-a' },
  )
  await deleteComment(fake.client, { id: '1', userId: 'user-a' })
  const comments = await getComments(fake.client, 1)
  assertEqual(
    comments,
    [{ id: '2', userId: 'user-b', body: "someone else's", createdAt: '2026-01-02T00:00:00.000Z' }],
    'a deleted comment no longer appears in getComments, for any viewer',
  )
}

// --- deleteComment: a non-author cannot delete, same as an RLS rejection would behave ---
//
// The fake's session (asUser) is 'user-b', not the row's own 'user-a' — and the input passed to
// deleteComment claims userId 'user-a' anyway, an attacker-controlled value pretending to be the
// author. The soft_delete_own_comment RPC never reads that claim (see delete-comment.ts and the
// migration's function body): only the session's real identity decides this, same as it would
// against a live database.

{
  const fake = makeFakeSupabase(
    [{ id: '1', user_id: 'user-a', trip_id: 1, body: 'not yours', created_at: '2026-01-01T00:00:00.000Z' }],
    { asUser: 'user-b' },
  )
  const result = await deleteComment(fake.client, { id: '1', userId: 'user-a' })
  assertEqual(result, { kind: 'not-found' }, "a non-author's delete attempt matches no row, same as the RPC's own auth.uid() = user_id check would enforce, even when the input claims to be the author")
  assertEqual(fake.rows[0]?.deleted_at ?? null, null, "the comment is left untouched when the acting session isn't its author")
}

// --- deleteComment: re-deleting an already-deleted comment reports not-found, not a second "deleted" ---
// (matches deleteCommentAction's own doc comment: 'not-found' already covers "an already-deleted
// comment" — this proves the RPC's `and deleted_at is null` guard is what makes that true.)

{
  const fake = makeFakeSupabase(
    [{ id: '1', user_id: 'user-a', trip_id: 1, body: 'mine', created_at: '2026-01-01T00:00:00.000Z', deleted_at: '2026-01-02T00:00:00.000Z' }],
    { asUser: 'user-a' },
  )
  const result = await deleteComment(fake.client, { id: '1', userId: 'user-a' })
  assertEqual(result, { kind: 'not-found' }, "deleting an already-deleted comment reports not-found instead of re-stamping it")
}

// --- deleteComment: an unknown comment id is reported the same way as an unauthorized one ---

{
  const fake = makeFakeSupabase([], { asUser: 'user-a' })
  const result = await deleteComment(fake.client, { id: 'missing', userId: 'user-a' })
  assertEqual(result, { kind: 'not-found' }, "deleting a comment id that doesn't exist reports not-found")
}

// --- deleteComment: db errors surface, don't throw ---

{
  const fake = makeFakeSupabase(
    [{ id: '1', user_id: 'user-a', trip_id: 1, body: 'mine', created_at: '2026-01-01T00:00:00.000Z' }],
    { asUser: 'user-a' },
  )
  fake.forceRpcError('connection refused')
  const result = await deleteComment(fake.client, { id: '1', userId: 'user-a' })
  assertEqual(result, { kind: 'db-error', message: 'failed to delete the comment' }, 'a failed rpc call surfaces as db-error, not a thrown exception')
  assert(fake.rpcCalls === 1, 'the failed rpc call is still counted as attempted')
}

// --- commentFormStateFor: the pure result -> form-state mapping ---

assertEqual(commentFormStateFor({ kind: 'posted' }), { status: 'success' }, 'a posted result maps to success')
assertEqual(
  commentFormStateFor({ kind: 'empty-body' }),
  { status: 'error', message: 'Write something before posting.' },
  'an empty-body result maps to a visible inline error',
)
assertEqual(
  commentFormStateFor({ kind: 'rate-limited' }),
  { status: 'error', message: "You're posting comments too quickly. Wait a minute and try again." },
  'a rate-limited result maps to a visible inline error naming the rate limit',
)
assertEqual(
  commentFormStateFor({ kind: 'db-error', message: 'irrelevant, not shown to the user' }),
  { status: 'error', message: 'Something went wrong posting your comment. Try again.' },
  'a db-error result maps to a generic inline error, not the raw db error message',
)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
