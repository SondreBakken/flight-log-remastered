import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mockAttachDisplayNames = vi.fn()

vi.mock('@/lib/profiles/attach-display-names', () => ({
  attachDisplayNames: (...args: unknown[]) => mockAttachDisplayNames(...args),
}))

import { getFollowersForPilot } from './get-followers-for-pilot'

// A minimal stand-in for Supabase's own chainable, thenable PostgrestFilterBuilder: every
// filter method returns the same builder so `.select().eq().order()` chains however the code
// under test calls them, and the builder itself resolves (via `then`) to the given result — same
// shape `await supabase.from(...).select(...)` resolves to for real.
function createFollowsQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve),
  }
  return builder
}

function fakeSupabase(result: { data: unknown; error: unknown }) {
  const builder = createFollowsQueryBuilder(result)
  return { from: vi.fn(() => builder) } as unknown as SupabaseClient
}

describe('getFollowersForPilot', () => {
  it('resolves display names for the queried rows via attachDisplayNames', async () => {
    const rows = [{ user_id: 'user-1', created_at: '2026-08-01T00:00:00Z' }]
    const supabase = fakeSupabase({ data: rows, error: null })
    mockAttachDisplayNames.mockResolvedValue([
      { userId: 'user-1', createdAt: '2026-08-01T00:00:00Z', displayName: 'Alice' },
    ])

    const result = await getFollowersForPilot(supabase, 4549)

    expect(mockAttachDisplayNames).toHaveBeenCalledWith(supabase, rows, expect.any(Function))
    expect(result).toEqual([{ userId: 'user-1', createdAt: '2026-08-01T00:00:00Z', displayName: 'Alice' }])
  })

  it('throws, distinguishably from an empty list, when the query errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = fakeSupabase({ data: null, error: { message: 'permission denied for table follows' } })

    await expect(getFollowersForPilot(supabase, 4549)).rejects.toThrow(/4549/)

    expect(mockAttachDisplayNames).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
