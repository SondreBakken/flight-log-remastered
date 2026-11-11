import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CountryIndex from './index'

const countries = [
  { countryId: 160, name: 'Norway' },
  { countryId: 29, name: 'Bouvet Island' },
  { countryId: 203, name: 'Sweden' },
]
const counts = {
  pilots: new Map([[160, 1293], [203, 800]]),
  clubs: new Map([[160, 12], [203, 5]]),
}

describe('CountryIndex', () => {
  it('links each country to /countries/<id>, not /countries/<name> — a name link 404s on the dynamic route', () => {
    render(<CountryIndex countries={countries} counts={null} />)

    expect(screen.getByRole('link', { name: 'Norway' }).getAttribute('href')).toBe('/countries/160')
    expect(screen.getByRole('link', { name: 'Bouvet Island' }).getAttribute('href')).toBe(
      '/countries/29',
    )
  })

  it('shows pilot and club counts per row, hides 0-club countries and ranks by pilots', () => {
    render(<CountryIndex countries={countries} counts={counts} />)

    const links = screen.getAllByRole('link').map((link) => link.textContent)
    expect(links).toEqual(['Norway', 'Sweden'])
    expect(screen.getByText('1293 pilots, 12 clubs')).toBeTruthy()
    expect(screen.getByText('800 pilots, 5 clubs')).toBeTruthy()
  })

  it('shows no counts and every country in the fallback, with the filter box present', () => {
    render(<CountryIndex countries={countries} counts={null} />)

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Bouvet Island',
      'Norway',
      'Sweden',
    ])
    expect(screen.queryByText(/pilots,/)).toBeNull()
    expect(screen.getByLabelText('Country name')).toBeTruthy()
  })

  it('filters by name case-insensitively, shows all on blank input, and says when nothing matches', () => {
    render(<CountryIndex countries={countries} counts={null} />)
    const input = screen.getByLabelText('Country name')

    fireEvent.change(input, { target: { value: 'NOR' } })
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Norway'])

    fireEvent.change(input, { target: { value: '   ' } })
    expect(screen.getAllByRole('link')).toHaveLength(3)

    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText(/No countries match/)).toBeTruthy()
  })
})
