import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlightFeedView } from './flight-feed-view'

describe('FlightFeedView', () => {
  it('shows an icon-bearing notice when the follow list is unavailable', () => {
    const { container } = render(<FlightFeedView follows={{ status: 'follows-unavailable' }} defaultPilotId={1} />)

    screen.getByText("Couldn't load the pilots you follow right now.")
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
