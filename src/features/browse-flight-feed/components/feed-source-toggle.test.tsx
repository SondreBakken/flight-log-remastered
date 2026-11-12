import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FeedSourceToggle, type FeedSourceMode } from './feed-source-toggle'

const MODES: Array<[string, FeedSourceMode]> = [
  ['Pilots', 'pilots'],
  ['Takeoffs', 'takeoffs'],
  ['Both', 'both'],
]

describe('FeedSourceToggle', () => {
  it('renders Pilots, Takeoffs and Both in that order', () => {
    render(<FeedSourceToggle mode="both" onChange={vi.fn()} />)

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Pilots', 'Takeoffs', 'Both'])
  })

  it.each(MODES)('marks only %s pressed when the mode is %s', (label, mode) => {
    render(<FeedSourceToggle mode={mode} onChange={vi.fn()} />)

    const pressed = screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true')
    expect(pressed.map((button) => button.textContent)).toEqual([label])
  })

  it.each(MODES)('reports %s as the next mode when clicked', (label, mode) => {
    const onChange = vi.fn()
    render(<FeedSourceToggle mode={mode === 'both' ? 'pilots' : 'both'} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: label }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith(mode)
  })
})
