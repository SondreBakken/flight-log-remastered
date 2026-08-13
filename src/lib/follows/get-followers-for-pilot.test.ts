import { describe, expect, it, vi } from 'vitest'
import { fakeSupabaseQuery } from '@/lib/testing/fake-supabase-query'
import { FollowsQueryError } from './follows-query-error'
import { ProfilesQueryError } from '@/lib/profiles/profiles-query-error'

const mockAttachDisplayNames = vi.fn()

vi.mock('@/lib/profiles/attach-display-names', () => ({
  attachDisplayNames: (...args: unknown[]) => mockAttachDisplayNames(...args),
}))

import { getFollowersForPilot } from './get-followers-for-pilot'

describe('getFollowersForPilot', () => {
  it('resolves display names for the queried rows via attachDisplayNames', async () => {
    const rows = [{ user_id: 'user-1', created_at: '2026-08-01T00:00:00Z' }]
    const { client } = fakeSupabaseQuery({ data: rows, error: null })
    mockAttachDisplayNames.mockResolvedValue([
      { userId: 'user-1', createdAt: '2026-08-01T00:00:00Z', displayName: 'Alice' },
    ])

    const result = await getFollowersForPilot(client, 4549)

    expect(mockAttachDisplayNames).toHaveBeenCalledWith(client, rows, expect.any(Function))
    expect(result).toEqual([{ userId: 'user-1', createdAt: '2026-08-01T00:00:00Z', displayName: 'Alice' }])
  })

  it('throws, distinguishably from an empty list, when the query errors, preserving the original error as cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queryError = { message: 'permission denied for table follows' }
    const { client } = fakeSupabaseQuery({ data: null, error: queryError })

    const error = await getFollowersForPilot(client, 4549).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(FollowsQueryError)
    expect((error as FollowsQueryError).message).toMatch(/4549/)
    expect((error as FollowsQueryError).cause).toBe(queryError)
    expect(mockAttachDisplayNames).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  // Explicit decision (see this function's own doc comment): a ProfilesQueryError from
  // attachDisplayNames is NOT recast into a FollowsQueryError here — its one caller
  // (account-activity's SectionErrorBoundary) catches any thrown error identically, so it
  // propagates as-is rather than being wrapped for no observable benefit.
  it('lets a ProfilesQueryError from attachDisplayNames propagate unchanged, not recast as a FollowsQueryError', async () => {
    const rows = [{ user_id: 'user-1', created_at: '2026-08-01T00:00:00Z' }]
    const { client } = fakeSupabaseQuery({ data: rows, error: null })
    const profilesError = new ProfilesQueryError('Failed to load display names for 1 user id: boom')
    mockAttachDisplayNames.mockRejectedValue(profilesError)

    await expect(getFollowersForPilot(client, 4549)).rejects.toBe(profilesError)
  })
})
