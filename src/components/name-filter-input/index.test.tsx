import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NameFilterInput } from './index'

describe('NameFilterInput', () => {
  it('uses the label as the accessible name and shows the fixed placeholder', () => {
    render(<NameFilterInput label="Country name" value="" onChange={() => {}} />)

    const input = screen.getByRole('textbox', { name: 'Country name' })
    expect(input.getAttribute('placeholder')).toBe('Filter by name')
  })

  it('shows the controlled value', () => {
    render(<NameFilterInput label="Country name" value="Nor" onChange={() => {}} />)

    expect((screen.getByLabelText('Country name') as HTMLInputElement).value).toBe('Nor')
  })

  it('calls onChange with the typed string, including an empty string when cleared', () => {
    const onChange = vi.fn()
    render(<NameFilterInput label="Takeoff name" value="abc" onChange={onChange} />)
    const input = screen.getByLabelText('Takeoff name')

    fireEvent.change(input, { target: { value: 'abcd' } })
    fireEvent.change(input, { target: { value: '' } })

    expect(onChange).toHaveBeenNthCalledWith(1, 'abcd')
    expect(onChange).toHaveBeenNthCalledWith(2, '')
  })

  it('defaults the wrapper class to relative', () => {
    const { container } = render(<NameFilterInput label="Country name" value="" onChange={() => {}} />)

    expect((container.firstElementChild as HTMLElement).className).toBe('relative')
  })

  it('appends a custom className after relative', () => {
    const { container } = render(<NameFilterInput label="Takeoff name" className="flex-1" value="" onChange={() => {}} />)

    expect((container.firstElementChild as HTMLElement).className).toBe('relative flex-1')
  })

  it('marks the icon as decorative', () => {
    const { container } = render(<NameFilterInput label="Country name" value="" onChange={() => {}} />)

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
