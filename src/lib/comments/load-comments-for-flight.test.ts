import { describe, expect, it, vi } from 'vitest'
import type { Comment } from './types'
import { CommentsQueryError } from './comments-query-error'

const mockGetComments = vi.fn()

vi.mock('./get-comments', () => ({
  getComments: (...args: unknown[]) => mockGetComments(...args),
}))

import { loadCommentsForFlight } from './load-comments-for-flight'

const comment: Comment = {
  id: 'comment-1',
  userId: 'user-a',
  body: 'nice flight',
  createdAt: '2026-01-01T00:00:00.000Z',
  displayName: 'Alex',
}

describe('loadCommentsForFlight', () => {
  it('reports a loaded status with the queried comments', async () => {
    mockGetComments.mockResolvedValue([comment])

    const result = await loadCommentsForFlight({} as never, 1)

    expect(result).toEqual({ status: 'loaded', comments: [comment] })
  })

  it('degrades to an explicit comments-unavailable status, without crashing, when getComments throws a CommentsQueryError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetComments.mockRejectedValue(new CommentsQueryError('comments query failed'))

    const result = await loadCommentsForFlight({} as never, 1)

    expect(result).toEqual({ status: 'comments-unavailable' })
    consoleError.mockRestore()
  })

  it('rethrows, rather than degrading, when getComments throws something other than a CommentsQueryError', async () => {
    mockGetComments.mockRejectedValue(new TypeError('data was null'))

    await expect(loadCommentsForFlight({} as never, 1)).rejects.toThrow(TypeError)
  })
})
