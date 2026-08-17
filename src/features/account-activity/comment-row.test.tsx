import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { CommentRow } from '@/features/account-activity/comment-row'
import type { CommentWithTripId } from '@/lib/comments/get-comments-for-trip-ids'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// index.test.tsx cannot exercise this component at all: CommentsOnMyFlights is an async Server
// Component rendered under Suspense, which never resolves under that suite's plain client-side
// render (see index.test.tsx's own doc comment on renderActivity) — so this row's coverage lives
// here instead, same split #218 used for longest-flights.test.tsx.
function remountRow(comment: CommentWithTripId) {
  cleanup()
  render(
    <ul>
      <CommentRow comment={comment} />
    </ul>,
  )
  return screen.getByRole('button')
}

const BASE_COMMENT: CommentWithTripId = {
  id: 'comment-1',
  tripId: 501,
  userId: 'user-abc',
  body: 'Great flight!',
  createdAt: '2026-05-01T12:00:00Z',
  displayName: 'Ada Lovelace',
}

beforeEach(() => {
  mockPush.mockClear()
})

describe('CommentRow', () => {
  it('renders the commenter name, trip id, and comment body', () => {
    remountRow(BASE_COMMENT)

    screen.getByText(/Ada Lovelace.*flight 501/)
    screen.getByText('Great flight!')
  })

  it('falls back to "Anonymous" when displayName is null', () => {
    remountRow({ ...BASE_COMMENT, displayName: null })

    screen.getByText(/Anonymous.*flight 501/)
  })

  // #223: role="button" must live on an inner wrapper, not the <li> itself — an <li> with its
  // implicit listitem role overridden stops the <ul> from being exposed as a list to assistive
  // tech (screen reader announces "button" instead of "list, 1 item").
  it('keeps the li a plain list item, exposing the ul as a list', () => {
    remountRow(BASE_COMMENT)

    const list = screen.getByRole('list')
    expect(list.querySelectorAll('li[role]')).toHaveLength(0)
    screen.getByRole('listitem')
  })

  it('navigates to the flight page when clicked anywhere', () => {
    const row = remountRow(BASE_COMMENT)

    fireEvent.click(row)

    expect(mockPush).toHaveBeenCalledWith('/flights/501')
  })

  it('navigates on Enter and Space, for keyboard users who cannot click', () => {
    const row = remountRow(BASE_COMMENT)

    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })

    expect(mockPush).toHaveBeenCalledTimes(2)
    expect(mockPush).toHaveBeenCalledWith('/flights/501')
  })

  it('does not navigate on an unrelated keypress', () => {
    const row = remountRow(BASE_COMMENT)

    fireEvent.keyDown(row, { key: 'Tab' })

    expect(mockPush).not.toHaveBeenCalled()
  })

  // A role="button" element gets no native activation from the browser, but Space still
  // triggers its default action for a role="button" — scrolling the page — unless
  // preventDefault() is called.
  it('prevents the default Space action (page scroll) when Space is pressed', () => {
    const row = remountRow(BASE_COMMENT)

    const keyDownEvent = createEvent.keyDown(row, { key: ' ' })
    fireEvent(row, keyDownEvent)

    expect(keyDownEvent.defaultPrevented).toBe(true)
  })
})
