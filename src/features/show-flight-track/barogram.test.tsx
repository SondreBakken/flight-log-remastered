import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { TrackPoint } from '@/lib/flightlog/types'
import { Barogram } from './barogram'

const NO_HOVER = () => {}

function point(secondsFromStart: number, altitude: number): TrackPoint {
  return { lat: 46, lon: 8, altitude, secondsFromStart }
}

describe('Barogram frame', () => {
  it('draws the real chart inside the MapFrame', () => {
    const points = [point(0, 1000), point(60, 1200), point(120, 1500)]
    const { container } = render(<Barogram points={points} hoveredIndex={null} onHoverIndex={NO_HOVER} />)

    const frame = container.querySelector('.border-frame')
    expect(frame).toBeTruthy()
    expect(frame?.querySelector('svg[role="slider"]')).toBeTruthy()
  })

  it('leaves the empty state unframed', () => {
    const { container } = render(<Barogram points={[]} hoveredIndex={null} onHoverIndex={NO_HOVER} />)

    expect(container.querySelector('.border-frame')).toBeNull()
    expect(container.textContent).toContain('No track points')
  })
})
