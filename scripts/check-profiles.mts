import type { SupabaseClient } from '@supabase/supabase-js'
import { getDisplayNames } from '../src/lib/profiles/get-display-names'
import { updateDisplayName } from '../src/lib/profiles/update-display-name'

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
// getDisplayNames/updateDisplayName both take an injected SupabaseClient (see their own doc
// comments) specifically so this script can drive them against a hand-built fake instead of a
// live database — same reasoning and shape as scripts/check-comments.mts and
// scripts/check-follow-store.mts's own fakes: a plain object implementing just the chain each
// function actually calls (from/select/in/upsert), matching how the real postgrest-js builder
// resolves.

type FakeProfileRow = { user_id: string; display_name: string | null }

function makeFakeSupabase(seedRows: FakeProfileRow[] = []) {
  const rows: FakeProfileRow[] = [...seedRows]
  let forcedSelectError: { message: string } | null = null
  let forcedUpsertError: { message: string } | null = null
  let upsertCalls = 0

  function makeSelectQuery() {
    let userIdFilter: string[] | null = null
    const query = {
      in(column: string, values: unknown) {
        if (column === 'user_id') userIdFilter = values as string[]
        return query
      },
      then(resolve: (result: { data: FakeProfileRow[] | null; error: { message: string } | null }) => void) {
        if (forcedSelectError) {
          resolve({ data: null, error: forcedSelectError })
          return
        }
        const matching = rows.filter((row) => userIdFilter === null || userIdFilter.includes(row.user_id))
        resolve({ data: matching, error: null })
      },
    }
    return query
  }

  const client = {
    from(table: string) {
      if (table !== 'profiles') throw new Error(`unexpected table: ${table}`)
      return {
        select() {
          return makeSelectQuery()
        },
        // Mirrors update-display-name.ts's real call: a single upsert, keyed on user_id, that
        // has to cover both "no row yet" (insert) and "row already exists" (update) — see the
        // migration's insert-and-update RLS policy pair for why the real table needs both paths.
        upsert(row: FakeProfileRow) {
          return {
            then(resolve: (result: { error: { message: string } | null }) => void) {
              upsertCalls++
              if (forcedUpsertError) {
                resolve({ error: forcedUpsertError })
                return
              }
              const existing = rows.find((existingRow) => existingRow.user_id === row.user_id)
              if (existing) existing.display_name = row.display_name
              else rows.push({ ...row })
              resolve({ error: null })
            },
          }
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
    forceUpsertError(message: string): void {
      forcedUpsertError = { message }
    },
    get upsertCalls() {
      return upsertCalls
    },
  }
}

// --- getDisplayNames ---

{
  const fake = makeFakeSupabase([
    { user_id: 'user-a', display_name: 'Alex' },
    { user_id: 'user-b', display_name: null },
  ])
  const names = await getDisplayNames(fake.client, ['user-a', 'user-b', 'user-c'])
  assertEqual(
    [...names.entries()].sort(),
    [
      ['user-a', 'Alex'],
      ['user-b', null],
    ],
    'getDisplayNames returns a name per known user, and no entry at all for a user with no profiles row',
  )
}

{
  const fake = makeFakeSupabase([{ user_id: 'user-a', display_name: 'Alex' }])
  const names = await getDisplayNames(fake.client, [])
  assertEqual([...names.entries()], [], 'getDisplayNames short-circuits to an empty Map without querying, given no user ids')
}

{
  const fake = makeFakeSupabase([{ user_id: 'user-a', display_name: 'Alex' }])
  fake.forceSelectError('connection refused')
  const names = await getDisplayNames(fake.client, ['user-a'])
  assertEqual([...names.entries()], [], 'getDisplayNames returns an empty Map, not a thrown exception, when the query fails')
}

// --- updateDisplayName ---

{
  const fake = makeFakeSupabase()
  const result = await updateDisplayName(fake.client, { userId: 'user-a', displayName: '  Alex  ' })
  assertEqual(result, { kind: 'saved' }, 'updateDisplayName reports saved on a successful upsert')
  assertEqual(fake.rows, [{ user_id: 'user-a', display_name: 'Alex' }], 'a first-time save inserts a trimmed name via upsert')
}

{
  const fake = makeFakeSupabase([{ user_id: 'user-a', display_name: 'Alex' }])
  await updateDisplayName(fake.client, { userId: 'user-a', displayName: 'Alexandra' })
  assertEqual(fake.rows, [{ user_id: 'user-a', display_name: 'Alexandra' }], 'saving again upserts over the existing row rather than duplicating it')
  assert(fake.upsertCalls === 1, 'updating an existing name goes through the same single upsert call, not a separate insert/update branch')
}

{
  const fake = makeFakeSupabase([{ user_id: 'user-a', display_name: 'Alex' }])
  const result = await updateDisplayName(fake.client, { userId: 'user-a', displayName: '   ' })
  assertEqual(result, { kind: 'saved' }, 'clearing the name (blank input) still reports saved')
  assertEqual(
    fake.rows,
    [{ user_id: 'user-a', display_name: null }],
    'a blank name is stored as null, not an empty string, so the comment falls back to Anonymous',
  )
}

{
  const fake = makeFakeSupabase()
  fake.forceUpsertError('constraint violation')
  const result = await updateDisplayName(fake.client, { userId: 'user-a', displayName: 'Alex' })
  assertEqual(result, { kind: 'db-error', message: 'failed to save the display name' }, 'a failed upsert surfaces as db-error, not a thrown exception')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
