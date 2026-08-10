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
