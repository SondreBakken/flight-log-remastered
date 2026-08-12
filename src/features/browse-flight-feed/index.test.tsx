import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlightFeedView } from './index'

describe('FlightFeedView empty state', () => {
  it('links to /countries, the actual browse-countries route, not a typo of it', () => {
    render(<FlightFeedView followedPilotIds={[]} defaultPilotId={4549} />)

    expect(
      screen.getByRole('link', { name: /browse clubs by country/i }).getAttribute('href'),
    ).toBe('/countries')
  })
})

describe('FlightFeedView followsUnavailable state', () => {
  it('renders a visible error notice, not the "follows nobody" empty state, when the follow list failed to load', () => {
    render(<FlightFeedView followedPilotIds={[]} defaultPilotId={4549} followsUnavailable />)

    expect(screen.getByText("Couldn't load the pilots you follow right now.")).toBeTruthy()
    expect(screen.queryByText('Flights from pilots you follow show up here.')).toBeNull()
  })

  it('renders the ordinary content when followsUnavailable is omitted, even with a genuinely empty follow list', () => {
    render(<FlightFeedView followedPilotIds={[]} defaultPilotId={4549} />)

    expect(screen.queryByText("Couldn't load the pilots you follow right now.")).toBeNull()
  })
})
