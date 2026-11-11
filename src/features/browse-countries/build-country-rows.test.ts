import { describe, expect, it } from 'vitest'
import { buildCountryRows } from './build-country-rows'

const countries = [
  { countryId: 1, name: 'Zeta' },
  { countryId: 2, name: 'Alpha' },
  { countryId: 3, name: 'Beta' },
  { countryId: 4, name: 'Gamma' },
  { countryId: 5, name: 'Delta' },
]

describe('buildCountryRows', () => {
  it('orders by pilots, then clubs, then name, hides 0-club countries and drops unknown ids', () => {
    const rows = buildCountryRows(countries, {
      pilots: new Map([[1, 100], [2, 100], [3, 100], [4, 500], [5, 900], [999, 5000]]),
      clubs: new Map([[1, 3], [2, 3], [3, 7], [4, 1], [999, 4]]),
    })

    expect(rows).toEqual([
      { countryId: 4, name: 'Gamma', pilots: 500, clubs: 1 },
      { countryId: 3, name: 'Beta', pilots: 100, clubs: 7 },
      { countryId: 2, name: 'Alpha', pilots: 100, clubs: 3 },
      { countryId: 1, name: 'Zeta', pilots: 100, clubs: 3 },
    ])
  })

  it('treats a missing pilot entry as 0 pilots', () => {
    const rows = buildCountryRows(countries, { pilots: new Map(), clubs: new Map([[2, 4]]) })

    expect(rows).toEqual([{ countryId: 2, name: 'Alpha', pilots: 0, clubs: 4 }])
  })

  it.each([
    ['empty clubs map', { pilots: new Map([[1, 5]]), clubs: new Map<number, number>() }],
    ['null counts', null],
  ])('falls back to every country in name order for %s', (_label, counts) => {
    expect(buildCountryRows(countries, counts).map((row) => row.name)).toEqual([
      'Alpha',
      'Beta',
      'Delta',
      'Gamma',
      'Zeta',
    ])
  })
})
