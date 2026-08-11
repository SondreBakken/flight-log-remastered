import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommentsErrorBoundary } from './comments-error-boundary'

function ThrowingChild(): never {
  throw new Error('boom')
}

describe('CommentsErrorBoundary', () => {
  it('renders the fallback instead of propagating when a child throws during render', () => {
    // React logs the caught error to the console even though the boundary handles it — expected
    // noise for this one assertion, not a real failure.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <CommentsErrorBoundary>
        <ThrowingChild />
      </CommentsErrorBoundary>,
    )

    expect(screen.getByText("Couldn't load flights right now.")).toBeTruthy()
    consoleError.mockRestore()
  })

  it('renders the child normally when it does not throw', () => {
    render(
      <CommentsErrorBoundary>
        <p>Comments loaded fine</p>
      </CommentsErrorBoundary>,
    )

    expect(screen.getByText('Comments loaded fine')).toBeTruthy()
    expect(screen.queryByText("Couldn't load flights right now.")).toBeNull()
  })
})
