import type { SupabaseClient } from '@supabase/supabase-js'
import { getDisplayNames } from '../src/lib/profiles/get-display-names'
import { updateDisplayName } from '../src/lib/profiles/update-display-name'
import { getFlightlogPilotIds } from '../src/lib/profiles/get-flightlog-pilot-ids'
import { updateFlightlogPilotId } from '../src/lib/profiles/update-flightlog-pilot-id'
import { isFallbackPilot } from '../src/lib/flightlog/is-fallback-pilot'
import { accountFormStateFor } from '../src/features/account/account-form-state'
import { pilotIdFormStateFor } from '../src/features/account/pilot-id-form-state'

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

// display_name and flightlog_pilot_id are both optional here (rather than two separate fake
// row types) so this one fake backs both get-display-names.ts/update-display-name.ts's tests
// below and get-flightlog-pilot-ids.ts/update-flightlog-pilot-id.ts's — a real profiles row
// always carries both columns, and no test needs the fake to reject a row missing one it isn't
// exercising.
type FakeProfileRow = { user_id: string; display_name?: string | null; flightlog_pilot_id?: number | null }

// Projects a row down to exactly the columns a `.select('a, b, c')` call asked for, mirroring
// PostgREST's own column-list behavior. Without this, narrowing or dropping a select's column
// list in the real implementation would still return full rows here and pass green — a select
// mistake is otherwise invisible to this fake. Same fix as scripts/check-account-activity.mts's
// and scripts/check-comments.mts's own project().
function project<T extends Record<string, unknown>>(row: T, columns: string): T {
  const keys = columns.split(',').map((column) => column.trim())
  const picked = {} as Record<string, unknown>
  for (const key of keys) picked[key] = row[key]
  return picked as T
}

function makeFakeSupabase(seedRows: FakeProfileRow[] = []) {
  const rows: FakeProfileRow[] = [...seedRows]
  let forcedSelectError: { message: string; code?: string } | null = null
  let forcedUpsertError: { message: string } | null = null
  let upsertCalls = 0

  function makeSelectQuery(columns: string) {
    let userIdFilter: string[] | null = null
    const query = {
      in(column: string, values: unknown) {
        if (column === 'user_id') userIdFilter = values as string[]
        return query
      },
      then(resolve: (result: { data: FakeProfileRow[] | null; error: { message: string; code?: string } | null }) => void) {
        if (forcedSelectError) {
          resolve({ data: null, error: forcedSelectError })
          return
        }
        const matching = rows.filter((row) => userIdFilter === null || userIdFilter.includes(row.user_id))
        resolve({ data: matching.map((row) => project(row, columns)), error: null })
      },
    }
    return query
  }

  const client = {
    from(table: string) {
      if (table !== 'profiles') throw new Error(`unexpected table: ${table}`)
      return {
        select(columns: string) {
          return makeSelectQuery(columns)
        },
        // Mirrors update-display-name.ts's/update-flightlog-pilot-id.ts's real calls: a single
        // upsert, keyed on user_id, that has to cover both "no row yet" (insert) and "row
        // already exists" (update) — see the migration's insert-and-update RLS policy pair for
        // why the real table needs both paths. Merges via Object.assign rather than overwriting
        // the whole row so an upsert touching only one column (e.g. flightlog_pilot_id) never
        // clobbers a display_name already on the same row, matching real Postgres upsert
        // semantics for the columns actually named in the row payload.
        upsert(row: FakeProfileRow) {
          return {
            then(resolve: (result: { error: { message: string } | null }) => void) {
              upsertCalls++
              if (forcedUpsertError) {
                resolve({ error: forcedUpsertError })
                return
              }
              const existing = rows.find((existingRow) => existingRow.user_id === row.user_id)
              if (existing) Object.assign(existing, row)
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
    forceSelectError(message: string, code?: string): void {
      forcedSelectError = { message, code }
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

// Mutation guard: dropping `display_name` from getDisplayNames's own select() list would leave
// it undefined here, since the fake now actually projects rows down to the requested columns
// instead of returning full rows regardless of what was selected.
{
  const fake = makeFakeSupabase([{ user_id: 'user-a', display_name: 'Alex' }])
  const names = await getDisplayNames(fake.client, ['user-a'])
  assert(
    names.get('user-a') === 'Alex',
    "getDisplayNames mutation guard: display_name is populated from the select's own columns, not left undefined by a narrowed select",
  )
}

// #150: a 42703 (undefined_column) error means the display_name column is missing — this must
// log a distinct message naming the migration, not the generic failure log, so the two
// situations aren't indistinguishable in production logs.
{
  const fake = makeFakeSupabase([{ user_id: 'user-a', display_name: 'Alex' }])
  fake.forceSelectError('column "display_name" does not exist', '42703')
  const loggedErrors: unknown[][] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => loggedErrors.push(args)
  const names = await getDisplayNames(fake.client, ['user-a'])
  console.error = originalConsoleError

  assertEqual([...names.entries()], [], 'getDisplayNames still returns an empty Map on a 42703 error, unchanged return contract')
  const loggedText = loggedErrors.map((args) => args.join(' ')).join('\n')
  assert(
    loggedText.includes('20260811000000_create_profiles.sql'),
    'a 42703 error logs the specific migration by name, not a generic error message',
  )
  assert(
    !loggedText.includes('failed to load display names'),
    'a 42703 error does NOT also fall through to the generic log message',
  )
}

// Proves the 42703 branch is genuinely conditional: a different (or absent) error code must
// still hit the existing generic log-and-empty-Map path unchanged.
{
  const fake = makeFakeSupabase([{ user_id: 'user-a', display_name: 'Alex' }])
  fake.forceSelectError('connection refused', '08006')
  const loggedErrors: unknown[][] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => loggedErrors.push(args)
  const names = await getDisplayNames(fake.client, ['user-a'])
  console.error = originalConsoleError

  assertEqual([...names.entries()], [], 'getDisplayNames returns an empty Map on a non-42703 error too')
  const loggedText = loggedErrors.map((args) => args.join(' ')).join('\n')
  assert(
    loggedText.includes('failed to load display names'),
    'an error code other than 42703 falls through to the generic log message, unchanged',
  )
  assert(
    !loggedText.includes('20260811000000_create_profiles.sql'),
    'an error code other than 42703 does not wrongly claim the migration is missing',
  )
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

// --- accountFormStateFor: the pure result -> form-state mapping ---

assertEqual(accountFormStateFor({ kind: 'saved' }), { status: 'success' }, 'a saved result maps to success')
assertEqual(
  accountFormStateFor({ kind: 'db-error', message: 'irrelevant, not shown to the user' }),
  { status: 'error', message: 'Something went wrong saving your display name. Try again.' },
  'a db-error result maps to a generic inline error, not the raw db error message',
)

// --- isFallbackPilot: the pure fallback-detection predicate behind pilotExists (issue #137) ---
//
// This is the only new decision logic #137 adds — pilotExists itself is a thin async wrapper
// around getPilotLogbook that this repo's check-*.mts convention can't drive directly (it
// transitively carries flights.ts's 'server-only' guard, see pilot-exists.ts's own doc comment)
// — so the predicate is where a mutation (e.g. && flipped to ||, or the wrong field compared)
// would actually surface. Each case below is chosen to kill a specific mutation rather than just
// exercise the happy path.

assertEqual(
  isFallbackPilot(12345, { userId: 12345, name: 'Pilot 12345', country: null, club: null }),
  true,
  'the exact synthetic fallback shape (name/country/club all matching the pattern) is detected',
)

assertEqual(
  isFallbackPilot(12345, { userId: 12345, name: 'Kari Nordmann', country: 'Norway', club: 'Voss HPK' }),
  false,
  'a real pilot with a name, country, and club is not the fallback',
)

assertEqual(
  isFallbackPilot(12345, { userId: 12345, name: 'Pilot 12345', country: 'Norway', club: null }),
  false,
  'a name matching the fallback pattern alone is not enough — a mutant that drops the country/club check (e.g. && -> ||) would wrongly report this as a fallback',
)

assertEqual(
  isFallbackPilot(12345, { userId: 12345, name: 'Kari Nordmann', country: null, club: null }),
  false,
  'null country and club alone are not enough — a real pilot who simply has neither on file must not read as nonexistent',
)

assertEqual(
  isFallbackPilot(12345, { userId: 12345, name: 'Pilot 999', country: null, club: null }),
  false,
  "the fallback name must match THIS pilot id specifically — a mutant that ignores pilotId (e.g. hardcodes a template or compares the wrong id) would wrongly match another pilot's fallback name",
)

assertEqual(
  isFallbackPilot(999, { userId: 12345, name: 'Pilot 12345', country: null, club: null }),
  false,
  'a pilot whose own userId does not match the pilotId argument is not the fallback for that pilotId — a mutant that reads pilot.userId instead of the pilotId parameter would wrongly match here, since every other fixture happens to have pilot.userId === pilotId',
)

// --- getFlightlogPilotIds ---

{
  const fake = makeFakeSupabase([
    { user_id: 'user-a', flightlog_pilot_id: 12677 },
    { user_id: 'user-b', flightlog_pilot_id: null },
  ])
  const pilotIds = await getFlightlogPilotIds(fake.client, ['user-a', 'user-b', 'user-c'])
  assertEqual(
    [...pilotIds.entries()].sort(),
    [
      ['user-a', 12677],
      ['user-b', null],
    ],
    'getFlightlogPilotIds returns a pilot id per known user, and no entry at all for a user with no profiles row',
  )
}

{
  const fake = makeFakeSupabase([{ user_id: 'user-a', flightlog_pilot_id: 12677 }])
  const pilotIds = await getFlightlogPilotIds(fake.client, [])
  assertEqual([...pilotIds.entries()], [], 'getFlightlogPilotIds short-circuits to an empty Map without querying, given no user ids')
}

// Mutation guard: dropping `flightlog_pilot_id` from getFlightlogPilotIds's own select() list
// would leave it undefined here, since the fake now actually projects rows down to the requested
// columns instead of returning full rows regardless of what was selected. This is the scenario
// that used to pass check:profiles green while silently breaking every user's pilot-id lookup in
// production (falls through to "not linked" for everyone) — see check-profiles.mts's own
// project() doc comment.
{
  const fake = makeFakeSupabase([{ user_id: 'user-a', flightlog_pilot_id: 12677 }])
  const pilotIds = await getFlightlogPilotIds(fake.client, ['user-a'])
  assert(
    pilotIds.get('user-a') === 12677,
    "getFlightlogPilotIds mutation guard: flightlog_pilot_id is populated from the select's own columns, not left undefined by a narrowed select",
  )
}

{
  const fake = makeFakeSupabase([{ user_id: 'user-a', flightlog_pilot_id: 12677 }])
  fake.forceSelectError('connection refused')
  const pilotIds = await getFlightlogPilotIds(fake.client, ['user-a'])
  assertEqual([...pilotIds.entries()], [], 'getFlightlogPilotIds returns an empty Map, not a thrown exception, when the query fails')
}

// #146: a 42703 (undefined_column) error means the flightlog_pilot_id migration hasn't been
// applied — this must log a distinct message naming the migration, not the generic failure log,
// so the two situations aren't indistinguishable in production logs.
{
  const fake = makeFakeSupabase([{ user_id: 'user-a', flightlog_pilot_id: 12677 }])
  fake.forceSelectError('column "flightlog_pilot_id" does not exist', '42703')
  const loggedErrors: unknown[][] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => loggedErrors.push(args)
  const pilotIds = await getFlightlogPilotIds(fake.client, ['user-a'])
  console.error = originalConsoleError

  assertEqual([...pilotIds.entries()], [], 'getFlightlogPilotIds still returns an empty Map on a 42703 error, unchanged return contract')
  const loggedText = loggedErrors.map((args) => args.join(' ')).join('\n')
  assert(
    loggedText.includes('20260811010000_add_flightlog_pilot_id_to_profiles.sql'),
    'a 42703 error logs the specific unapplied migration by name, not a generic error message',
  )
  assert(
    !loggedText.includes('failed to load flightlog pilot ids'),
    'a 42703 error does NOT also fall through to the generic log message',
  )
}

// Proves the 42703 branch is genuinely conditional: a different (or absent) error code must
// still hit the existing generic log-and-empty-Map path unchanged.
{
  const fake = makeFakeSupabase([{ user_id: 'user-a', flightlog_pilot_id: 12677 }])
  fake.forceSelectError('connection refused', '08006')
  const loggedErrors: unknown[][] = []
  const originalConsoleError = console.error
  console.error = (...args: unknown[]) => loggedErrors.push(args)
  const pilotIds = await getFlightlogPilotIds(fake.client, ['user-a'])
  console.error = originalConsoleError

  assertEqual([...pilotIds.entries()], [], 'getFlightlogPilotIds returns an empty Map on a non-42703 error too')
  const loggedText = loggedErrors.map((args) => args.join(' ')).join('\n')
  assert(
    loggedText.includes('failed to load flightlog pilot ids'),
    'an error code other than 42703 falls through to the generic log message, unchanged',
  )
  assert(
    !loggedText.includes('20260811010000_add_flightlog_pilot_id_to_profiles.sql'),
    'an error code other than 42703 does not wrongly claim the migration is missing',
  )
}

// --- updateFlightlogPilotId ---
//
// checkPilotExists is a hand-built fake here, not the real pilotExists (see that function's own
// doc comment on why it's an injected argument rather than a default) — these tests exercise
// updateFlightlogPilotId's own orchestration (gate on existence, then upsert) without a live
// flightlog.org request.

function makeCapturingPilotExists(result: boolean) {
  const calls: number[] = []
  return {
    check: async (pilotId: number): Promise<boolean> => {
      calls.push(pilotId)
      return result
    },
    calls,
  }
}

{
  const fake = makeFakeSupabase()
  const pilotExists = makeCapturingPilotExists(true)
  const result = await updateFlightlogPilotId(fake.client, { userId: 'user-a', pilotId: 12677 }, pilotExists.check)
  assertEqual(result, { kind: 'saved' }, 'updateFlightlogPilotId reports saved when the pilot id exists and the upsert succeeds')
  assertEqual(fake.rows, [{ user_id: 'user-a', flightlog_pilot_id: 12677 }], 'a first-time save upserts the pilot id')
  assertEqual(pilotExists.calls, [12677], 'the exact pilot id submitted is the one checked for existence')
}

{
  const fake = makeFakeSupabase([{ user_id: 'user-a', display_name: 'Alex' }])
  const pilotExists = makeCapturingPilotExists(true)
  await updateFlightlogPilotId(fake.client, { userId: 'user-a', pilotId: 12677 }, pilotExists.check)
  assertEqual(
    fake.rows,
    [{ user_id: 'user-a', display_name: 'Alex', flightlog_pilot_id: 12677 }],
    'linking a pilot id merges onto an existing row rather than clobbering its display name',
  )
}

{
  const fake = makeFakeSupabase()
  const pilotExists = makeCapturingPilotExists(false)
  const result = await updateFlightlogPilotId(fake.client, { userId: 'user-a', pilotId: 999999 }, pilotExists.check)
  assertEqual(result, { kind: 'invalid-pilot-id' }, "a pilot id flightlog.org doesn't recognise is reported as invalid-pilot-id")
  assert(fake.upsertCalls === 0, 'a nonexistent pilot id is rejected before any upsert is attempted, not saved then flagged')
}

{
  const fake = makeFakeSupabase()
  fake.forceUpsertError('constraint violation')
  const pilotExists = makeCapturingPilotExists(true)
  const result = await updateFlightlogPilotId(fake.client, { userId: 'user-a', pilotId: 12677 }, pilotExists.check)
  assertEqual(result, { kind: 'db-error', message: 'failed to save the flightlog pilot id' }, 'a failed upsert surfaces as db-error, not a thrown exception')
}

// --- pilotIdFormStateFor: the pure result -> form-state mapping ---

assertEqual(pilotIdFormStateFor({ kind: 'saved' }), { status: 'success' }, 'a saved result maps to success')
assertEqual(
  pilotIdFormStateFor({ kind: 'invalid-pilot-id' }),
  {
    status: 'error',
    message: "That doesn't look like a flightlog.org pilot id. Check the number on your flightlog.org profile and try again.",
  },
  'an invalid-pilot-id result maps to a message naming the actual problem',
)
assertEqual(
  pilotIdFormStateFor({ kind: 'db-error', message: 'irrelevant, not shown to the user' }),
  { status: 'error', message: 'Something went wrong saving your flightlog.org pilot id. Try again.' },
  'a db-error result maps to a generic inline error, not the raw db error message',
)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} - ${failures} failure(s)`)
if (failures > 0) process.exit(1)
