import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CommentForm } from './comment-form'

const mockSubmitComment = vi.fn()

vi.mock('./actions', () => ({
  submitComment: (...args: unknown[]) => mockSubmitComment(...args),
}))

function fillAndSubmit(body: string) {
  fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: body } })
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }))
}

describe('CommentForm', () => {
  it('binds the given tripId ahead of the prevState/formData pair React supplies', async () => {
    mockSubmitComment.mockResolvedValue({ status: 'success' })

    render(<CommentForm tripId={99} />)
    fillAndSubmit('great flight today')

    await screen.findByRole('button', { name: 'Post comment' })
    expect(mockSubmitComment).toHaveBeenCalledWith(99, { status: 'idle' }, expect.any(FormData))
    const submittedBody = (mockSubmitComment.mock.calls[0][2] as FormData).get('body')
    expect(submittedBody).toBe('great flight today')
  })

  it('shows the inline error message the action returns, without navigating away', async () => {
    mockSubmitComment.mockResolvedValue({
      status: 'error',
      message: "You're posting comments too quickly. Wait a minute and try again.",
    })

    render(<CommentForm tripId={1} />)
    fillAndSubmit('one too many')

    await screen.findByText("You're posting comments too quickly. Wait a minute and try again.")
    expect(screen.getByLabelText('Add a comment')).toBeTruthy()
  })

  it('clears the textarea once the action reports success', async () => {
    mockSubmitComment.mockResolvedValue({ status: 'success' })

    render(<CommentForm tripId={1} />)
    fillAndSubmit('nice flight')

    await screen.findByDisplayValue('')
  })

  it('disables the submit button while the action is pending', async () => {
    let resolveAction!: (state: { status: 'success' }) => void
    mockSubmitComment.mockReturnValue(new Promise((resolve) => (resolveAction = resolve)))

    render(<CommentForm tripId={1} />)
    fillAndSubmit('slow network')

    expect(await screen.findByRole('button', { name: 'Posting…' })).toHaveProperty('disabled', true)

    resolveAction({ status: 'success' })
    await screen.findByRole('button', { name: 'Post comment' })
  })
})
