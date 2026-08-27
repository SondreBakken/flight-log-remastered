import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './index'

describe('EmptyState', () => {
  it('renders its children with an icon and the dashed-border box classes', () => {
    const { container } = render(<EmptyState>No flights recorded yet.</EmptyState>)

    screen.getByText('No flights recorded yet.')
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('.border-dashed')).toBeTruthy()
  })

  it('marks the icon as decorative', () => {
    const { container } = render(<EmptyState>Nothing here.</EmptyState>)

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
