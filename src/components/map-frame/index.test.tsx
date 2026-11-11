import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MapFrame } from './index'

describe('MapFrame', () => {
  it('renders one div with the frame classes around its children', () => {
    const { container } = render(
      <MapFrame>
        <span>inner</span>
      </MapFrame>,
    )

    const frame = container.firstElementChild as HTMLElement
    expect(container.children).toHaveLength(1)
    for (const cls of ['border', 'border-frame', 'bg-paper', 'p-2', 'w-full']) {
      expect(frame.classList.contains(cls)).toBe(true)
    }
    expect(frame.firstElementChild).toBe(screen.getByText('inner'))
  })

  it('appends a caller className', () => {
    const { container } = render(<MapFrame className="mt-4">x</MapFrame>)

    expect((container.firstElementChild as HTMLElement).classList.contains('mt-4')).toBe(true)
  })
})
