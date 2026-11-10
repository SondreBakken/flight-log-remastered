import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VerificationStamp } from './index'

describe('VerificationStamp', () => {
  it('names itself by the label, as accessible name and title', () => {
    render(<VerificationStamp label="Verified pilot" />)

    const stamp = screen.getByRole('img', { name: 'Verified pilot' })
    expect(stamp.getAttribute('title')).toBe('Verified pilot')
    expect(stamp.className).toContain('text-stamp')
  })

  it('hides the inner svg from assistive tech', () => {
    const { container } = render(<VerificationStamp label="Verified pilot" />)

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it.each([
    [16, false],
    [19, false],
    [20, true],
    [24, true],
  ])('at size %i is tilted: %s', (size, tilted) => {
    render(<VerificationStamp label="x" size={size} />)

    const stamp = screen.getByRole('img')
    expect(stamp.className.includes('-rotate-6')).toBe(tilted)
    expect(document.querySelector('svg')?.getAttribute('width')).toBe(String(size))
  })

  it('defaults to a tilted 20 px stamp', () => {
    const { container } = render(<VerificationStamp label="x" />)

    expect(screen.getByRole('img').className).toContain('-rotate-6')
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('20')
  })
})
