import { describe, expect, it, vi } from 'vitest'
import { fakeSupabaseQuery } from '@/lib/testing/fake-supabase-query'
import { CommentsQueryError } from './comments-query-error'

const mockAttachDisplayNames = vi.fn()

vi.mock('@/lib/profiles/attach-display-names', () => ({
  attachDisplayNames: (...args: unknown[]) => mockAttachDisplayNames(...args),
}))

import { getCommentsForTripIds } from './get-comments-for-trip-ids'

describe('getCommentsForTripIds', () => {
  it('short-circuits to an empty list without querying when tripIds is empty', async () => {
    const { client } = fakeSupabaseQuery({ data: null, error: null })

    const result = await getCommentsForTripIds(client, [])

    expect(result).toEqual([])
    expect(client.from).not.toHaveBeenCalled()
  })

  it('scopes the query with .in() across the given trip ids and resolves display names via attachDisplayNames', async () => {
    const rows = [{ id: 'comment-1', user_id: 'user-1', trip_id: 100, body: 'nice flight', created_at: '2026-08-01T00:00:00Z' }]
    const { client, builder } = fakeSupabaseQuery({ data: rows, error: null })
    mockAttachDisplayNames.mockResolvedValue([
      { id: 'comment-1', tripId: 100, userId: 'user-1', body: 'nice flight', createdAt: '2026-08-01T00:00:00Z', displayName: 'Alice' },
    ])

    const result = await getCommentsForTripIds(client, [100, 200])

    expect(builder.in).toHaveBeenCalledWith('trip_id', [100, 200])
    expect(mockAttachDisplayNames).toHaveBeenCalledWith(client, rows, expect.any(Function))
    expect(result).toEqual([
      { id: 'comment-1', tripId: 100, userId: 'user-1', body: 'nice flight', createdAt: '2026-08-01T00:00:00Z', displayName: 'Alice' },
    ])
  })

  it('throws, distinguishably from an empty list, when the query errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeSupabaseQuery({ data: null, error: { message: 'permission denied for table comments' } })

    await expect(getCommentsForTripIds(client, [100])).rejects.toThrow(CommentsQueryError)

    expect(mockAttachDisplayNames).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
