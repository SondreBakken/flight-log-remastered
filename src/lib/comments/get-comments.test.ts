import { describe, expect, it, vi } from 'vitest'
import { fakeSupabaseQuery } from '@/lib/testing/fake-supabase-query'
import { CommentsQueryError } from './comments-query-error'

const mockAttachDisplayNames = vi.fn()

vi.mock('@/lib/profiles/attach-display-names', () => ({
  attachDisplayNames: (...args: unknown[]) => mockAttachDisplayNames(...args),
}))

import { getComments } from './get-comments'

describe('getComments', () => {
  it('resolves display names for the queried rows via attachDisplayNames', async () => {
    const rows = [{ id: 'comment-1', user_id: 'user-1', body: 'nice flight', created_at: '2026-08-01T00:00:00Z' }]
    const { client } = fakeSupabaseQuery({ data: rows, error: null })
    mockAttachDisplayNames.mockResolvedValue([
      { id: 'comment-1', userId: 'user-1', body: 'nice flight', createdAt: '2026-08-01T00:00:00Z', displayName: 'Alice' },
    ])

    const result = await getComments(client, 4549)

    expect(mockAttachDisplayNames).toHaveBeenCalledWith(client, rows, expect.any(Function))
    expect(result).toEqual([
      { id: 'comment-1', userId: 'user-1', body: 'nice flight', createdAt: '2026-08-01T00:00:00Z', displayName: 'Alice' },
    ])
  })

  it('throws, distinguishably from an empty list, when the query errors, preserving the original error as cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const queryError = { message: 'permission denied for table comments' }
    const { client } = fakeSupabaseQuery({ data: null, error: queryError })

    const error = await getComments(client, 4549).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(CommentsQueryError)
    expect((error as CommentsQueryError).cause).toBe(queryError)
    expect(mockAttachDisplayNames).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
