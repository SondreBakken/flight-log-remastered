import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FollowersErrorBoundary } from './followers-error-boundary'

function ThrowingChild(): never {
  throw new Error('boom')
}

describe('FollowersErrorBoundary', () => {
  it('renders the fallback instead of propagating when a child throws during render', () => {
    // React logs the caught error to the console even though the boundary handles it — expected
    // noise for this one assertion, not a real failure.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <FollowersErrorBoundary>
        <ThrowingChild />
      </FollowersErrorBoundary>,
    )

    expect(screen.getByText("Couldn't load followers right now.")).toBeTruthy()
    consoleError.mockRestore()
  })

  it('renders the child normally when it does not throw', () => {
    render(
      <FollowersErrorBoundary>
        <p>Followers loaded fine</p>
      </FollowersErrorBoundary>,
    )

    expect(screen.getByText('Followers loaded fine')).toBeTruthy()
    expect(screen.queryByText("Couldn't load followers right now.")).toBeNull()
  })
})
