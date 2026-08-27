import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Callout } from './index'

describe('Callout', () => {
  it('renders warning-tone content with an icon and the amber box classes', () => {
    const { container } = render(<Callout tone="warning">Something needs attention.</Callout>)

    screen.getByText('Something needs attention.')
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('.border-amber-500\\/30')).toBeTruthy()
  })

  it('renders error-tone content with an icon and the red box classes', () => {
    const { container } = render(<Callout tone="error">Something broke.</Callout>)

    screen.getByText('Something broke.')
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('.border-red-500\\/30')).toBeTruthy()
  })

  it('renders arbitrary children unchanged, e.g. a heading plus a paragraph', () => {
    render(
      <Callout tone="error">
        <h2>Could not load this</h2>
        <p>Details here.</p>
      </Callout>,
    )

    screen.getByRole('heading', { name: 'Could not load this' })
    screen.getByText('Details here.')
  })

  it('marks the icon as decorative so it never becomes part of the accessible name', () => {
    const { container } = render(<Callout tone="warning">Message text</Callout>)

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
