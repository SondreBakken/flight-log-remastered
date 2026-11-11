import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/flightlog/countries', () => ({ getCountries: vi.fn() }))
vi.mock('@/lib/flightlog/country-counts', () => ({ getCountryCounts: vi.fn() }))

import { getCountries } from '@/lib/flightlog/countries'
import { getCountryCounts } from '@/lib/flightlog/country-counts'
import { Countries } from './page'

const countries = [
  { countryId: 160, name: 'Norway' },
  { countryId: 29, name: 'Bouvet Island' },
]

describe('Countries', () => {
  it('still renders every country when the a=3 counts fetch rejects', async () => {
    vi.mocked(getCountries).mockResolvedValue(countries)
    vi.mocked(getCountryCounts).mockRejectedValue(new Error('a=3 down'))

    render(await Countries())

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Bouvet Island', 'Norway'])
    expect(screen.queryByText(/pilots,/)).toBeNull()
  })

  it('renders counts and hides 0-club countries when a=3 succeeds', async () => {
    vi.mocked(getCountries).mockResolvedValue(countries)
    vi.mocked(getCountryCounts).mockResolvedValue({ pilots: [[160, 1293]], clubs: [[160, 12]] })

    render(await Countries())

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Norway'])
    expect(screen.getByText('1293 pilots, 12 clubs')).toBeTruthy()
  })
})
