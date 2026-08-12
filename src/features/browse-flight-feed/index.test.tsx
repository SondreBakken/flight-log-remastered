import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlightFeedView } from './index'

describe('FlightFeedView empty state', () => {
  it('links to /countries, the actual browse-countries route, not a typo of it', () => {
    render(<FlightFeedView follows={{ status: 'resolved', followedPilotIds: [] }} defaultPilotId={4549} />)

    expect(
      screen.getByRole('link', { name: /browse clubs by country/i }).getAttribute('href'),
    ).toBe('/countries')
  })
})

describe('FlightFeedView follows-unavailable state', () => {
  it('renders a visible error notice, not the "follows nobody" empty state, when the follow list failed to load', () => {
    render(<FlightFeedView follows={{ status: 'follows-unavailable' }} defaultPilotId={4549} />)

    expect(screen.getByText("Couldn't load the pilots you follow right now.")).toBeTruthy()
    expect(screen.queryByText('Flights from pilots you follow show up here.')).toBeNull()
  })

  it('renders the ordinary content for a resolved, genuinely empty follow list', () => {
    render(<FlightFeedView follows={{ status: 'resolved', followedPilotIds: [] }} defaultPilotId={4549} />)

    expect(screen.queryByText("Couldn't load the pilots you follow right now.")).toBeNull()
  })

  it('renders the ordinary empty state for a signed-out visitor too, same as a resolved empty list', () => {
    render(<FlightFeedView follows={{ status: 'signed-out' }} defaultPilotId={4549} />)

    expect(screen.queryByText("Couldn't load the pilots you follow right now.")).toBeNull()
    expect(screen.getByText('Flights from pilots you follow show up here.')).toBeTruthy()
  })
})
