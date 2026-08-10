import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockCreateClient = vi.fn()
const mockGetUser = vi.fn()
const mockPostComment = vi.fn()
const mockDeleteComment = vi.fn()
const mockRevalidatePath = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock('@/lib/comments/post-comment', () => ({
  postComment: (...args: unknown[]) => mockPostComment(...args),
}))

vi.mock('@/lib/comments/delete-comment', () => ({
  deleteComment: (...args: unknown[]) => mockDeleteComment(...args),
}))

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}))

import { deleteCommentAction, submitComment } from './actions'
import { commentFormStateFor } from './comment-form-state'

function formDataWithBody(body: string | undefined): FormData {
  const formData = new FormData()
  if (body !== undefined) formData.set('body', body)
  return formData
}

beforeEach(() => {
  mockCreateClient.mockResolvedValue({ auth: { getUser: mockGetUser } })
})

afterEach(() => {
  vi.spyOn(console, 'error').mockRestore()
})

describe('submitComment', () => {
  it('rejects with a sign-in prompt, never reaching postComment, when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const state = await submitComment(1, { status: 'idle' }, formDataWithBody('hello'))

    expect(state).toEqual({ status: 'error', message: 'Sign in to post a comment.' })
    expect(mockPostComment).not.toHaveBeenCalled()
  })

  it('rejects without touching Supabase at all when the body field is missing (a malformed direct POST)', async () => {
    const state = await submitComment(1, { status: 'idle' }, formDataWithBody(undefined))

    expect(state).toEqual({ status: 'error', message: 'Write something before posting.' })
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it('passes the authenticated userId, the bound tripId, and the submitted body to postComment', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockPostComment.mockResolvedValue({ kind: 'posted' })

    await submitComment(42, { status: 'idle' }, formDataWithBody('nice flight'))

    expect(mockPostComment).toHaveBeenCalledWith(
      expect.anything(),
      { tripId: 42, userId: 'user-abc', body: 'nice flight' },
    )
  })

  it('revalidates the flight page and reports success when postComment succeeds', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockPostComment.mockResolvedValue({ kind: 'posted' })

    const state = await submitComment(42, { status: 'idle' }, formDataWithBody('nice flight'))

    expect(state).toEqual({ status: 'success' })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/flights/42')
  })

  it('does not revalidate and surfaces the rate-limit error when postComment rejects the post', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockPostComment.mockResolvedValue({ kind: 'rate-limited' })

    const state = await submitComment(42, { status: 'idle' }, formDataWithBody('one too many'))

    expect(state).toEqual({ status: 'error', message: "You're posting comments too quickly. Wait a minute and try again." })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('shows a generic error, without crashing, when Supabase is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateClient.mockImplementation(() => {
      throw new Error('Supabase is not configured')
    })

    const state = await submitComment(1, { status: 'idle' }, formDataWithBody('hello'))

    expect(state).toEqual({ status: 'error', message: 'Something went wrong posting your comment. Try again.' })
    expect(mockPostComment).not.toHaveBeenCalled()
  })
})

describe('deleteCommentAction', () => {
  it('rejects with a sign-in prompt, never reaching deleteComment, when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const result = await deleteCommentAction(1, 'comment-1')

    expect(result).toEqual({ status: 'error', message: 'Sign in to delete your comment.' })
    expect(mockDeleteComment).not.toHaveBeenCalled()
  })

  it('passes the authenticated userId and the given commentId to deleteComment', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockDeleteComment.mockResolvedValue({ kind: 'deleted' })

    await deleteCommentAction(42, 'comment-1')

    expect(mockDeleteComment).toHaveBeenCalledWith(expect.anything(), { id: 'comment-1', userId: 'user-abc' })
  })

  it('revalidates the flight page and reports success when deleteComment deletes the comment', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockDeleteComment.mockResolvedValue({ kind: 'deleted' })

    const result = await deleteCommentAction(42, 'comment-1')

    expect(result).toEqual({ status: 'success' })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/flights/42')
  })

  it('still reports success and revalidates when deleteComment finds nothing to delete (already gone or not the author)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockDeleteComment.mockResolvedValue({ kind: 'not-found' })

    const result = await deleteCommentAction(42, 'comment-1')

    expect(result).toEqual({ status: 'success' })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/flights/42')
  })

  it('does not revalidate and surfaces a generic error when deleteComment hits a db error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } })
    mockDeleteComment.mockResolvedValue({ kind: 'db-error', message: 'raw db detail' })

    const result = await deleteCommentAction(42, 'comment-1')

    expect(result).toEqual({ status: 'error', message: 'Something went wrong deleting your comment. Try again.' })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('shows a generic error, without crashing, when Supabase is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateClient.mockImplementation(() => {
      throw new Error('Supabase is not configured')
    })

    const result = await deleteCommentAction(1, 'comment-1')

    expect(result).toEqual({ status: 'error', message: 'Something went wrong deleting your comment. Try again.' })
    expect(mockDeleteComment).not.toHaveBeenCalled()
  })
})

describe('commentFormStateFor', () => {
  it('maps every PostCommentResult kind to a form state', () => {
    expect(commentFormStateFor({ kind: 'posted' })).toEqual({ status: 'success' })
    expect(commentFormStateFor({ kind: 'empty-body' })).toEqual({
      status: 'error',
      message: 'Write something before posting.',
    })
    expect(commentFormStateFor({ kind: 'rate-limited' })).toEqual({
      status: 'error',
      message: "You're posting comments too quickly. Wait a minute and try again.",
    })
    expect(commentFormStateFor({ kind: 'db-error', message: 'raw db detail' })).toEqual({
      status: 'error',
      message: 'Something went wrong posting your comment. Try again.',
    })
  })
})
