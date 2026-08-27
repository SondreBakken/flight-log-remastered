import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ErrorPage from './error'

describe('ErrorPage', () => {
  it('shows the error message and an icon-bearing "Try again" button that calls reset on click', () => {
    const reset = vi.fn()
    const { container } = render(<ErrorPage error={Object.assign(new Error('scrape failed'), {})} reset={reset} />)

    screen.getByRole('heading', { name: 'Could not load this from flightlog.org' })
    screen.getByText('scrape failed')
    expect(container.querySelectorAll('svg').length).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
