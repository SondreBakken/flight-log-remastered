import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommentsQueryError } from '@/lib/comments/comments-query-error'
import type { Comment } from '@/lib/comments/types'

const mockGetSupabaseEnv = vi.fn()
const mockCreateClient = vi.fn()
const mockGetUser = vi.fn()
const mockGetComments = vi.fn()

vi.mock('@/lib/supabase/env', () => ({
  getSupabaseEnv: () => mockGetSupabaseEnv(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock('@/lib/comments/get-comments', () => ({
  getComments: (...args: unknown[]) => mockGetComments(...args),
}))

// Not the focus of this suite (it reads auth client-side via its own hook, unrelated to
// getComments's error path under test) — stubbed the same way browse-flown-sites-map/
// index.test.tsx stubs the map it isn't asserting on.
vi.mock('./comment-composer', () => ({
  CommentComposer: () => <div data-testid="stub-comment-composer" />,
}))

vi.mock('./actions', () => ({
  deleteCommentAction: vi.fn(),
}))

import CommentsOnFlight from './index'

const comment: Comment = {
  id: 'comment-1',
  userId: 'user-a',
  body: 'nice flight',
  createdAt: '2026-01-01T00:00:00.000Z',
  displayName: 'Alex',
}

async function renderSection(tripId = 1) {
  render(await CommentsOnFlight({ tripId }))
}

beforeEach(() => {
  mockGetSupabaseEnv.mockReturnValue({ url: 'https://example.supabase.co', anonKey: 'anon-key' })
  mockCreateClient.mockResolvedValue({ auth: { getUser: mockGetUser } })
  mockGetUser.mockResolvedValue({ data: { user: null } })
})

describe('CommentsOnFlight', () => {
  it('renders comments normally when the query succeeds', async () => {
    mockGetComments.mockResolvedValue([comment])

    await renderSection()

    screen.getByText('nice flight')
    expect(screen.queryByText("Couldn't load comments right now.")).toBeNull()
  })

  it('renders "No comments yet." for a genuinely empty, successful query', async () => {
    mockGetComments.mockResolvedValue([])

    await renderSection()

    screen.getByText('No comments yet.')
  })

  it('renders a distinguishable failure notice, not "No comments yet.", when getComments throws a CommentsQueryError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetComments.mockRejectedValue(new CommentsQueryError('comments query failed'))

    await renderSection()

    screen.getByText("Couldn't load comments right now.")
    expect(screen.queryByText('No comments yet.')).toBeNull()
    consoleError.mockRestore()
  })

  it('still renders the composer when the comment list failed to load — posting is independent of the load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetComments.mockRejectedValue(new CommentsQueryError('comments query failed'))

    await renderSection()

    screen.getByTestId('stub-comment-composer')
    consoleError.mockRestore()
  })

  it('rethrows, rather than degrading, when getComments throws something other than a CommentsQueryError', async () => {
    mockGetComments.mockRejectedValue(new TypeError('data was null'))

    await expect(CommentsOnFlight({ tripId: 1 })).rejects.toThrow(TypeError)
  })
})
