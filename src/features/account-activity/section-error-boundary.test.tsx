import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SectionErrorBoundary } from './section-error-boundary'

function ThrowingChild(): never {
  throw new Error('boom')
}

describe('SectionErrorBoundary', () => {
  it('renders the given fallback instead of propagating when a child throws during render', () => {
    // React logs the caught error to the console even though the boundary handles it — expected
    // noise for this one assertion, not a real failure.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <SectionErrorBoundary fallback="Couldn't load followers right now.">
        <ThrowingChild />
      </SectionErrorBoundary>,
    )

    expect(screen.getByText("Couldn't load followers right now.")).toBeTruthy()
    consoleError.mockRestore()
  })

  it('renders a different fallback string for a different caller, without a code change', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <SectionErrorBoundary fallback="Couldn't load flights right now.">
        <ThrowingChild />
      </SectionErrorBoundary>,
    )

    expect(screen.getByText("Couldn't load flights right now.")).toBeTruthy()
    consoleError.mockRestore()
  })

  it('renders the child normally when it does not throw', () => {
    render(
      <SectionErrorBoundary fallback="Couldn't load followers right now.">
        <p>Followers loaded fine</p>
      </SectionErrorBoundary>,
    )

    expect(screen.getByText('Followers loaded fine')).toBeTruthy()
    expect(screen.queryByText("Couldn't load followers right now.")).toBeNull()
  })
})
