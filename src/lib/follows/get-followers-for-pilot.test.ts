import { describe, expect, it, vi } from 'vitest'
import { fakeFollowsSupabase } from '@/lib/testing/follows-query-builder-fake'

const mockAttachDisplayNames = vi.fn()

vi.mock('@/lib/profiles/attach-display-names', () => ({
  attachDisplayNames: (...args: unknown[]) => mockAttachDisplayNames(...args),
}))

import { getFollowersForPilot } from './get-followers-for-pilot'

describe('getFollowersForPilot', () => {
  it('resolves display names for the queried rows via attachDisplayNames', async () => {
    const rows = [{ user_id: 'user-1', created_at: '2026-08-01T00:00:00Z' }]
    const { client } = fakeFollowsSupabase({ data: rows, error: null })
    mockAttachDisplayNames.mockResolvedValue([
      { userId: 'user-1', createdAt: '2026-08-01T00:00:00Z', displayName: 'Alice' },
    ])

    const result = await getFollowersForPilot(client, 4549)

    expect(mockAttachDisplayNames).toHaveBeenCalledWith(client, rows, expect.any(Function))
    expect(result).toEqual([{ userId: 'user-1', createdAt: '2026-08-01T00:00:00Z', displayName: 'Alice' }])
  })

  it('throws, distinguishably from an empty list, when the query errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeFollowsSupabase({ data: null, error: { message: 'permission denied for table follows' } })

    await expect(getFollowersForPilot(client, 4549)).rejects.toThrow(/4549/)

    expect(mockAttachDisplayNames).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
