import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getFollowedPilotIds } from './get-followed-pilot-ids'

// A minimal stand-in for Supabase's own chainable, thenable PostgrestFilterBuilder: every
// filter method returns the same builder so `.select().eq().in()` chains however the code under
// test calls them, and the builder itself resolves (via `then`) to the given result — same shape
// `await supabase.from(...).select(...)` resolves to for real.
function createFollowsQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  }
  return builder
}

function fakeSupabase(result: { data: unknown; error: unknown }) {
  const builder = createFollowsQueryBuilder(result)
  return { from: vi.fn(() => builder), builder } as unknown as SupabaseClient & { builder: typeof builder }
}

describe('getFollowedPilotIds', () => {
  it('returns the queried pilot ids as a Set', async () => {
    const supabase = fakeSupabase({ data: [{ pilot_id: 4549 }, { pilot_id: 12677 }], error: null })

    const result = await getFollowedPilotIds(supabase, 'user-abc')

    expect(result).toEqual(new Set([4549, 12677]))
  })

  it('short-circuits to an empty Set without querying when candidatePilotIds is an empty array', async () => {
    const supabase = fakeSupabase({ data: null, error: null })

    const result = await getFollowedPilotIds(supabase, 'user-abc', [])

    expect(result).toEqual(new Set())
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('scopes the query with .in() when candidatePilotIds is given', async () => {
    const supabase = fakeSupabase({ data: [], error: null })

    await getFollowedPilotIds(supabase, 'user-abc', [4549, 12677])

    expect(supabase.builder.in).toHaveBeenCalledWith('pilot_id', [4549, 12677])
  })

  it('throws, distinguishably from an empty Set, when the query errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = fakeSupabase({ data: null, error: { message: 'permission denied for table follows' } })

    await expect(getFollowedPilotIds(supabase, 'user-abc')).rejects.toThrow(/user-abc/)

    consoleError.mockRestore()
  })
})
