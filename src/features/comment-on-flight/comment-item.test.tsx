import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CommentItem } from './comment-item'
import type { Comment } from '@/lib/comments/types'

const mockDeleteCommentAction = vi.fn()

vi.mock('./actions', () => ({
  deleteCommentAction: (...args: unknown[]) => mockDeleteCommentAction(...args),
}))

const comment: Comment = {
  id: 'comment-1',
  userId: 'user-a',
  body: 'nice flight',
  createdAt: '2026-01-01T00:00:00.000Z',
  displayName: 'Alex',
}

describe('CommentItem', () => {
  it('renders the comment author\'s display name', () => {
    render(<CommentItem comment={comment} isOwnComment={false} tripId={1} />)

    expect(screen.getByText('Alex')).toBeTruthy()
  })

  it('falls back to "Anonymous" when the author has no display name set', () => {
    render(<CommentItem comment={{ ...comment, displayName: null }} isOwnComment={false} tripId={1} />)

    expect(screen.getByText('Anonymous')).toBeTruthy()
  })

  it('shows a delete control on the viewer\'s own comment', () => {
    render(<CommentItem comment={comment} isOwnComment tripId={1} />)

    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  })

  it('shows no delete control on another author\'s comment', () => {
    render(<CommentItem comment={comment} isOwnComment={false} tripId={1} />)

    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('calls deleteCommentAction with the tripId and commentId when the delete control is clicked', async () => {
    mockDeleteCommentAction.mockResolvedValue({ status: 'success' })

    render(<CommentItem comment={comment} isOwnComment tripId={42} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await screen.findByRole('button', { name: 'Delete' })
    expect(mockDeleteCommentAction).toHaveBeenCalledWith(42, 'comment-1')
  })

  it('shows the inline error message the action returns, without removing the comment itself', async () => {
    mockDeleteCommentAction.mockResolvedValue({ status: 'error', message: 'Something went wrong deleting your comment. Try again.' })

    render(<CommentItem comment={comment} isOwnComment tripId={1} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await screen.findByText('Something went wrong deleting your comment. Try again.')
    expect(screen.getByText('nice flight')).toBeTruthy()
  })

  it('disables the delete control while the action is pending', async () => {
    let resolveAction!: (result: { status: 'success' }) => void
    mockDeleteCommentAction.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)))

    render(<CommentItem comment={comment} isOwnComment tripId={1} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(await screen.findByRole('button', { name: 'Deleting…' })).toHaveProperty('disabled', true)

    resolveAction({ status: 'success' })
    await screen.findByRole('button', { name: 'Delete' })
  })
})
