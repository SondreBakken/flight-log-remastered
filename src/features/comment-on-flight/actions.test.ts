import { describe, expect, it, vi } from 'vitest'

const mockDb = { name: 'db' }
const mockGetCurrentUserId = vi.fn()
const mockPostComment = vi.fn()
const mockDeleteComment = vi.fn()
const mockRevalidatePath = vi.fn()

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
}))

vi.mock('@/lib/db/client', () => ({
  getDb: () => mockDb,
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

describe('submitComment', () => {
  it('rejects with a sign-in prompt, never reaching postComment, when there is no session', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    const state = await submitComment(1, { status: 'idle' }, formDataWithBody('hello'))

    expect(state).toEqual({ status: 'error', message: 'Sign in to post a comment.' })
    expect(mockPostComment).not.toHaveBeenCalled()
  })

  it('rejects without posting when the body field is missing (a malformed direct POST)', async () => {
    const state = await submitComment(1, { status: 'idle' }, formDataWithBody(undefined))

    expect(state).toEqual({ status: 'error', message: 'Write something before posting.' })
    expect(mockPostComment).not.toHaveBeenCalled()
  })

  it('passes the authenticated userId, the bound tripId, and the submitted body to postComment', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockPostComment.mockResolvedValue({ kind: 'posted' })

    await submitComment(42, { status: 'idle' }, formDataWithBody('nice flight'))

    expect(mockPostComment).toHaveBeenCalledWith(mockDb, { tripId: 42, userId: 'user-abc', body: 'nice flight' })
  })

  // Former RLS insert policy: a comment is only ever written as the signed-in user.
  it('posts as the session user, ignoring a user id the client slips into the form', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockPostComment.mockResolvedValue({ kind: 'posted' })
    const formData = formDataWithBody('nice flight')
    formData.set('userId', 'someone-else')
    formData.set('user_id', 'someone-else')

    await submitComment(42, { status: 'idle' }, formData)

    expect(mockPostComment).toHaveBeenCalledWith(mockDb, { tripId: 42, userId: 'user-abc', body: 'nice flight' })
  })

  it('revalidates the flight page and reports success when postComment succeeds', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockPostComment.mockResolvedValue({ kind: 'posted' })

    const state = await submitComment(42, { status: 'idle' }, formDataWithBody('nice flight'))

    expect(state).toEqual({ status: 'success' })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/flights/42')
  })

  it('does not revalidate and surfaces the rate-limit error when postComment rejects the post', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockPostComment.mockResolvedValue({ kind: 'rate-limited' })

    const state = await submitComment(42, { status: 'idle' }, formDataWithBody('one too many'))

    expect(state).toEqual({ status: 'error', message: "You're posting comments too quickly. Wait a minute and try again." })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

})

describe('deleteCommentAction', () => {
  it('rejects with a sign-in prompt, never reaching deleteComment, when there is no session', async () => {
    mockGetCurrentUserId.mockResolvedValue(null)

    const result = await deleteCommentAction(1, 'comment-1')

    expect(result).toEqual({ status: 'error', message: 'Sign in to delete your comment.' })
    expect(mockDeleteComment).not.toHaveBeenCalled()
  })

  it('passes the authenticated userId and the given commentId to deleteComment', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockDeleteComment.mockResolvedValue({ kind: 'deleted' })

    await deleteCommentAction(42, 'comment-1')

    expect(mockDeleteComment).toHaveBeenCalledWith(mockDb, { id: 'comment-1', userId: 'user-abc' })
  })

  it('revalidates the flight page and reports success when deleteComment deletes the comment', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockDeleteComment.mockResolvedValue({ kind: 'deleted' })

    const result = await deleteCommentAction(42, 'comment-1')

    expect(result).toEqual({ status: 'success' })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/flights/42')
  })

  it('still reports success and revalidates when deleteComment finds nothing to delete (already gone or not the author)', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockDeleteComment.mockResolvedValue({ kind: 'not-found' })

    const result = await deleteCommentAction(42, 'comment-1')

    expect(result).toEqual({ status: 'success' })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/flights/42')
  })

  it('does not revalidate and surfaces a generic error when deleteComment hits a db error', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-abc')
    mockDeleteComment.mockResolvedValue({ kind: 'db-error', message: 'raw db detail' })

    const result = await deleteCommentAction(42, 'comment-1')

    expect(result).toEqual({ status: 'error', message: 'Something went wrong deleting your comment. Try again.' })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
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
