import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import CountryIndex from './index'

describe('CountryIndex', () => {
  it('links each country to /countries/<id>, not /countries/<name> — a name link 404s on the dynamic route', () => {
    render(
      <CountryIndex
        countries={[
          { countryId: 160, name: 'Norway' },
          { countryId: 29, name: 'Bouvet Island' },
        ]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Norway' }).getAttribute('href')).toBe('/countries/160')
    expect(screen.getByRole('link', { name: 'Bouvet Island' }).getAttribute('href')).toBe(
      '/countries/29',
    )
  })
})
