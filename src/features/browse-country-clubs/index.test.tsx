import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import CountryClubs from './index'

describe('CountryClubs', () => {
  it('renders a table row per club when clubs exist', () => {
    render(
      <CountryClubs
        countryName="Norway"
        clubs={[{ clubId: 32, name: 'Jetta Luftsportsklubb', flightCount: 18 }]}
      />,
    )

    // getByRole/getByText throw if not found, so their return alone is the assertion.
    screen.getByRole('table')
    screen.getByText('Jetta Luftsportsklubb')
  })

  it('renders the deliberate empty state, not a table, when the country has no clubs', () => {
    render(<CountryClubs countryName="Bouvet Island" clubs={[]} />)

    expect(screen.queryByRole('table')).toBeNull()
    screen.getByText(/no clubs recorded/i)
  })
})
